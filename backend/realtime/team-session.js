const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { createChildLogger } = require("../logger");
const { scoreTeamDrill } = require("../services/team-drill/scoring");
const { ingestAttempt } = require("../services/attempts");
const { getModule, getCheckpointDefinitions } = require("../services/modules");

// simple memory store for rooms and connections
const rooms = new Map(); // roomId -> { users, state, marker, userMeta }

const ALLOWED_ROLES = ["alarm", "extinguisher_operator", "backup_coordinator"];
const STATE_RULES = Object.freeze({
  alarm_pulled: { role: "alarm" },
  fire_extinguished: { role: "extinguisher_operator", requires: "alarm_pulled" },
  evac_checked: { role: "backup_coordinator", requires: "fire_extinguished" }
});

const ACTION_RULES = Object.freeze({
  fire_alarm: { role: "alarm" },
  alarm_pulled: { role: "alarm" },
  fire_extinguisher: { role: "extinguisher_operator" },
  fire_extinguished: { role: "extinguisher_operator" },
  evacuation_check: { role: "backup_coordinator" },
  evac_checked: { role: "backup_coordinator" }
});

// initialize room state machine and timeline
function createRoom() {
  return {
    users: new Map(),
    userMeta: new Map(),
    state: {},
    marker: null,
    phase: "lobby",
    readyUsers: new Set(),
    phaseStartedAtMs: 0,
    timeline: { guided: [], unguided: [] },
    actions: new Map(),
    roleDoubling: null
  };
}

// presence thresholds in ms
const STALE_MS = 5000;
const DEAD_MS = 20000;
const PRESENCE_CHECK_INTERVAL_MS = 1000;

// send one private websocket error to the client that made the bad request
function sendError(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", message }));
}

// validate every state flag before changing room state
function validateStateUpdate(state, role, currentState, roleDoubling = null) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { ok: false, reason: "state update must be an object" };
  }

  const keys = Object.keys(state);
  if (keys.length === 0) {
    return { ok: false, reason: "state update cannot be empty" };
  }

  const nextState = { ...currentState };
  for (const key of keys) {
    const rule = STATE_RULES[key];
    if (!rule) return { ok: false, reason: "unknown team state" };
    if (state[key] !== true) return { ok: false, reason: `${key} must be true` };
    const isOwner = rule.role === role || (roleDoubling && roleDoubling[rule.role] === role);
    if (!isOwner) return { ok: false, reason: `${role} cannot set ${key}` };
    if (rule.requires && nextState[rule.requires] !== true) {
      return { ok: false, reason: `${key} requires ${rule.requires}` };
    }
    nextState[key] = true;
  }

  return { ok: true, state: nextState };
}

// check if drill is running, stop if someone drops
function isRoomDrillActive(room) {
  if (!room) return false;
  return room.phase === "guided" || room.phase === "unguided";
}

// kick user, tell peers, abort drill if mid-action
function removeUser(ws, roomId, role, rooms, broadcastToRoom, log) {
  const room = rooms.get(roomId);
  if (!room) return;

  const hadUser = room.users.has(ws);
  room.users.delete(ws);
  if (room.userMeta) room.userMeta.delete(ws);
  if (room.readyUsers) room.readyUsers.delete(ws);

  if (hadUser) {
    broadcastToRoom(roomId, { type: "peer_left", role });

    if (isRoomDrillActive(room)) {
      room.phase = "lobby";
      room.state = {};
      room.readyUsers.clear();
      room.actions.clear();
      room.roleDoubling = null;
      broadcastToRoom(roomId, { type: "drill_aborted", reason: `${role} disconnected` });
      broadcastToRoom(roomId, { type: "phase", phase: "lobby", roleDoubling: null });
    }
    log.info({ roomId, role }, "user left room");
  }

  if (room.users.size === 0) {
    rooms.delete(roomId);
  }
}

// clock and timer injection defaults, overridden in tests
const DEFAULT_CLOCK = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => global.setTimeout(fn, ms),
  clearTimeout: (id) => global.clearTimeout(id),
  setInterval: (fn, ms) => global.setInterval(fn, ms),
  clearInterval: (id) => global.clearInterval(id)
};

// setup realtime ws server with clock and database
function initRealtimeServer(server, config, logger, optionsOrClock) {
  const wss = new WebSocketServer({ server });
  const log = logger ? logger.child({ component: "team-session" }) : createChildLogger({ component: "team-session" });

  let clock = DEFAULT_CLOCK;
  let db = (config && config.db) || null;

  if (optionsOrClock) {
    if (typeof optionsOrClock.now === "function") {
      clock = optionsOrClock;
    } else if (typeof optionsOrClock === "object") {
      if (optionsOrClock.clock) clock = optionsOrClock.clock;
      if (optionsOrClock.db) db = optionsOrClock.db;
    }
  }

  // presence check loop: mark stale at 5s, remove at 20s
  const presenceInterval = clock.setInterval(() => {
    const now = clock.now();
    for (const [roomId, room] of rooms) {
      if (!room.userMeta) continue;
      for (const [ws, meta] of Array.from(room.userMeta.entries())) {
        const silent = now - meta.lastSeen;
        if (silent >= DEAD_MS) {
          log.info({ roomId, role: meta.role, silentMs: silent }, "user dead, removing");
          removeUser(ws, roomId, meta.role, rooms, broadcastToRoom, log);
          if (ws.readyState === 1) ws.close();
        } else if (silent >= STALE_MS && !meta.stale) {
          meta.stale = true;
          broadcastToRoom(roomId, { type: "peer_stale", role: meta.role });
          log.info({ roomId, role: meta.role, silentMs: silent }, "user stale");
        }
      }
    }
  }, PRESENCE_CHECK_INTERVAL_MS);

  wss.on("connection", (ws) => {
    let currentRoomId = null;
    let currentRole = null;

    // touch lastSeen on any message
    function touchPresence() {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room || !room.userMeta) return;
      const meta = room.userMeta.get(ws);
      if (meta) {
        meta.lastSeen = clock.now();
        if (meta.stale) {
          meta.stale = false;
          // un-stale: no broadcast needed, peers will see fresh positions
        }
      }
    }

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          sendError(ws, "message must be an object");
          return;
        }

        // every message refreshes presence
        touchPresence();
        
        if (data.type === "join") {
          const { roomId, role, workerId } = data;
          if (!ALLOWED_ROLES.includes(role)) {
            ws.send(JSON.stringify({ type: "error", message: "invalid role" }));
            return;
          }

          // validate worker against database if db is available
          if (db) {
            if (!workerId) {
              sendError(ws, "workerId required");
              return;
            }
            const workerRow = db.prepare("SELECT worker_id FROM worker WHERE worker_id = ?").get(workerId);
            if (!workerRow) {
              sendError(ws, "unknown worker");
              return;
            }
          }

          if (!rooms.has(roomId)) {
            rooms.set(roomId, createRoom());
          }
          const room = rooms.get(roomId);
          if (!room.userMeta) room.userMeta = new Map();

          // one worker per room
          if (workerId) {
            for (const [existingWs, existingRole] of Array.from(room.users.entries())) {
              const meta = room.userMeta.get(existingWs);
              if (meta && meta.workerId === workerId) {
                const isStaleOrDead = meta.stale || (clock.now() - meta.lastSeen >= STALE_MS);
                const isClosed = existingWs.readyState !== 1;
                if (isStaleOrDead || isClosed) {
                  removeUser(existingWs, roomId, existingRole, rooms, broadcastToRoom, log);
                  if (existingWs.readyState === 1) existingWs.close();
                  break;
                }
                sendError(ws, "worker already in room");
                return;
              }
            }
          }

          // marker calibration: first joiner sets room marker, others must match
          const joinMarker = data.markerId && data.markerSizeCm
            ? { markerId: data.markerId, markerSizeCm: data.markerSizeCm }
            : null;
          if (joinMarker) {
            if (!room.marker) {
              room.marker = joinMarker;
            } else if (room.marker.markerId !== joinMarker.markerId || room.marker.markerSizeCm !== joinMarker.markerSizeCm) {
              sendError(ws, "different marker");
              return;
            }
          }

          // check if role already claimed by a LIVE socket
          for (const [existingWs, existingRole] of Array.from(room.users.entries())) {
            if (existingRole === role) {
              // allow reclaim if old socket is stale or closed
              const meta = room.userMeta.get(existingWs);
              const isStaleOrDead = meta && (meta.stale || (clock.now() - meta.lastSeen >= STALE_MS));
              const isClosed = existingWs.readyState !== 1;
              if (isStaleOrDead || isClosed) {
                removeUser(existingWs, roomId, role, rooms, broadcastToRoom, log);
                if (existingWs.readyState === 1) existingWs.close();
                break;
              }
              ws.send(JSON.stringify({ type: "error", message: "role already claimed" }));
              return;
            }
          }

          // join successful
          room.users.set(ws, role);
          room.userMeta.set(ws, {
            role,
            workerId: workerId || null,
            deviceId: data.deviceId || null,
            locale: data.locale || "en",
            lastSeen: clock.now(),
            stale: false
          });
          currentRoomId = roomId;
          currentRole = role;

          ws.send(JSON.stringify({ type: "joined", roomId, role, state: room.state, phase: room.phase, roleDoubling: room.roleDoubling }));
          log.info({ roomId, role }, "user joined room");
          
          // broadcast to others that someone joined
          broadcastToRoom(roomId, { type: "peer_joined", role }, ws);
        } else if (data.type === "heartbeat") {
          // presence already touched above, record marker visibility
          const room = rooms.get(currentRoomId);
          if (room && room.userMeta) {
            const meta = room.userMeta.get(ws);
            if (meta) meta.markerVisible = Boolean(data.markerVisible);
          }
        } else if (data.type === "ready") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          if (room.phase === "complete") {
            // all ready returns to lobby for fresh drill
            room.readyUsers.add(ws);
            const requiredReady = (room.users && room.users.size <= 2) ? 2 : 3;
            if (room.readyUsers.size >= requiredReady) {
              room.phase = "lobby";
              room.state = {};
              room.readyUsers.clear();
              room.timeline = { guided: [], unguided: [] };
              room.actions.clear();
              room.roleDoubling = null;
              broadcastToRoom(currentRoomId, { type: "phase", phase: "lobby", roleDoubling: null });
            }
            return;
          }

          if (room.phase === "lobby") {
            room.readyUsers.add(ws);
            const rolesInRoom = Array.from(room.users.values());
            const hasAllRoles = ALLOWED_ROLES.every((r) => rolesInRoom.includes(r));
            if (hasAllRoles && room.readyUsers.size >= 3) {
              room.roleDoubling = null;
              room.phase = "guided";
              room.phaseStartedAtMs = clock.now();
              room.state = {};
              room.timeline = { guided: [], unguided: [] };
              room.actions.clear();
              broadcastToRoom(currentRoomId, {
                type: "phase",
                phase: "guided",
                startedAtMs: room.phaseStartedAtMs,
                roleDoubling: null
              });
            } else if (room.users.size === 2 && room.readyUsers.size >= 2) {
              const hasAlarm = rolesInRoom.includes("alarm");
              const hasExt = rolesInRoom.includes("extinguisher_operator");
              if (hasAlarm && hasExt && !rolesInRoom.includes("backup_coordinator")) {
                room.roleDoubling = { backup_coordinator: "alarm" };
                room.phase = "guided";
                room.phaseStartedAtMs = clock.now();
                room.state = {};
                room.timeline = { guided: [], unguided: [] };
                room.actions.clear();
                broadcastToRoom(currentRoomId, {
                  type: "phase",
                  phase: "guided",
                  startedAtMs: room.phaseStartedAtMs,
                  roleDoubling: room.roleDoubling
                });
              }
            }
          }
        } else if (data.type === "action_start") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;
          const action = data.action;
          const rule = ACTION_RULES[action];
          if (!rule) {
            sendError(ws, "unknown action");
            return;
          }
          const isOwner = rule.role === currentRole || (room.roleDoubling && room.roleDoubling[rule.role] === currentRole);
          if (!isOwner) {
            const reason = `${rule.role} role owns ${action}; you are ${currentRole}`;
            if (room.phase === "guided" || room.phase === "unguided") {
              const tMs = clock.now() - room.phaseStartedAtMs;
              room.timeline[room.phase].push({ role: currentRole, action, reason, tMs, accepted: false });
            }
            sendError(ws, reason);
            return;
          }
          const existingStatus = room.actions.get(action);
          if (existingStatus === "started" || existingStatus === "done") {
            sendError(ws, `action ${action} already started or completed`);
            return;
          }
          room.actions.set(action, "started");
          broadcastToRoom(currentRoomId, {
            type: "peer_action",
            role: currentRole,
            action,
            status: "started"
          });
        } else if (data.type === "action_end") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;
          const action = data.action;
          const rule = ACTION_RULES[action];
          if (!rule) {
            sendError(ws, "unknown action");
            return;
          }
          const isOwner = rule.role === currentRole || (room.roleDoubling && room.roleDoubling[rule.role] === currentRole);
          if (!isOwner) {
            sendError(ws, `${rule.role} role owns ${action}; you are ${currentRole}`);
            return;
          }
          room.actions.set(action, "done");
          broadcastToRoom(currentRoomId, {
            type: "peer_action",
            role: currentRole,
            action,
            status: "done"
          });
        } else if (data.type === "update_position") {
          // relay minimal marker-relative position: { x, z, headingDeg }
          if (currentRoomId && currentRole) {
            broadcastToRoom(currentRoomId, {
              type: "peer_position",
              role: currentRole,
              position: data.position
            }, ws);
          }
        } else if (data.type === "state_update") {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (!room) {
              sendError(ws, "room not found");
              return;
            }
            if (room.phase !== "guided" && room.phase !== "unguided") {
              sendError(ws, "drill not active");
              return;
            }

            const currentPhase = room.phase;
            const tMs = clock.now() - room.phaseStartedAtMs;
            const result = validateStateUpdate(data.state, currentRole, room.state, room.roleDoubling);

            if (!result.ok) {
              log.warn({
                event: "team_state_update_rejected",
                roomId: currentRoomId,
                role: currentRole,
                reason: result.reason
              }, "Team state update rejected");
              const attemptedAction = (data.state && typeof data.state === "object") ? Object.keys(data.state)[0] : "unknown";
              room.timeline[currentPhase].push({
                role: currentRole,
                action: attemptedAction,
                reason: result.reason,
                tMs,
                accepted: false
              });
              sendError(ws, result.reason);
              return;
            }

            // record accepted actions in timeline
            for (const key of Object.keys(data.state)) {
              room.timeline[currentPhase].push({
                role: currentRole,
                action: key,
                tMs,
                accepted: true
              });
            }

            // handle phase transitions on evac_checked
            if (result.state.evac_checked) {
              if (currentPhase === "guided") {
                // guided complete -> reset flags and enter unguided
                room.phase = "unguided";
                room.state = {};
                room.phaseStartedAtMs = clock.now();
                room.actions.clear();
                broadcastToRoom(currentRoomId, {
                  type: "phase",
                  phase: "unguided",
                  startedAtMs: room.phaseStartedAtMs,
                  roleDoubling: room.roleDoubling
                });
                broadcastToRoom(currentRoomId, { type: "state_changed", state: room.state });
              } else if (currentPhase === "unguided") {
                // unguided complete -> phase complete and compute drill result
                room.phase = "complete";
                room.state = result.state;
                broadcastToRoom(currentRoomId, { type: "state_changed", state: room.state }, ws);
                broadcastToRoom(currentRoomId, { type: "phase", phase: "complete", roleDoubling: room.roleDoubling });
                const rolesInRoom = Array.from(room.users.values());
                const scored = scoreTeamDrill(room.timeline.unguided, rolesInRoom);

                const attempts = {};
                if (db) {
                  const nowIso = new Date(clock.now()).toISOString();
                  const startedAtMs = room.phaseStartedAtMs || clock.now();
                  const startedAtIso = new Date(startedAtMs).toISOString();
                  const durationMs = Math.max(0, clock.now() - startedAtMs);

                  const alarmEv = room.timeline.unguided.find((e) => e.action === "alarm_pulled" && e.accepted);
                  const fireEv = room.timeline.unguided.find((e) => e.action === "fire_extinguished" && e.accepted);
                  const evacEv = room.timeline.unguided.find((e) => e.action === "evac_checked" && e.accepted);

                  const moduleRow = getModule(db, "fire-response-team");
                  const definitions = getCheckpointDefinitions(db, "fire-response-team");

                  for (const [userWs, userRole] of room.users.entries()) {
                    const meta = room.userMeta.get(userWs);
                    const workerId = meta && meta.workerId;
                    if (!workerId) continue;

                    const attemptId = crypto.randomUUID();
                    const attempt = {
                      contractVersion: "2.0",
                      attemptId,
                      workerId,
                      moduleId: "fire-response-team",
                      moduleVersion: 1,
                      engineVersion: "team-drill-1.0",
                      deviceId: (meta && meta.deviceId) || `device-${workerId.toLowerCase()}`,
                      arTier: 2,
                      locale: (meta && meta.locale) || "en",
                      startedAt: startedAtIso,
                      completedAt: nowIso,
                      durationMs,
                      status: "completed",
                      checkpoints: [
                        {
                          checkpointId: "team_alarm_pull",
                          observedAt: alarmEv ? new Date(startedAtMs + alarmEv.tMs).toISOString() : nowIso,
                          observation: {
                            kind: "selection_single",
                            selected: alarmEv ? "alarm_pulled" : "skipped"
                          }
                        },
                        {
                          checkpointId: "team_fire_extinguish",
                          observedAt: fireEv ? new Date(startedAtMs + fireEv.tMs).toISOString() : nowIso,
                          observation: {
                            kind: "selection_single",
                            selected: fireEv ? "fire_extinguished" : "skipped"
                          }
                        },
                        {
                          checkpointId: "team_evac_coordinate",
                          observedAt: evacEv ? new Date(startedAtMs + evacEv.tMs).toISOString() : nowIso,
                          observation: {
                            kind: "selection_single",
                            selected: evacEv ? "evac_checked" : "skipped"
                          }
                        }
                      ],
                      clientClaimedPercentage: scored.teamScore,
                      clientClaimedPassed: Boolean(scored.passed)
                    };

                    if (moduleRow && definitions && definitions.length > 0) {
                      try {
                        ingestAttempt(db, {
                          attempt,
                          definitions,
                          moduleRow,
                          batchId: null,
                          receivedAt: nowIso
                        });
                        attempts[userRole] = attemptId;
                      } catch (err) {
                        log.error({ err, workerId }, "Failed to ingest team attempt");
                      }
                    }
                  }
                }

                const resultPayload = {
                  type: "drill_result",
                  teamScore: scored.teamScore,
                  passed: scored.passed,
                  perRole: scored.perRole,
                  breakdown: scored.breakdown,
                  timeline: room.timeline.unguided,
                  attempts
                };
                broadcastToRoom(currentRoomId, resultPayload);
              }
            } else {
              room.state = result.state;
              broadcastToRoom(currentRoomId, { type: "state_changed", state: room.state }, ws);
            }
          }
        }
      } catch (err) {
        log.error({ err }, "failed to process ws message");
      }
    });

    ws.on("close", () => {
      if (currentRoomId) {
        removeUser(ws, currentRoomId, currentRole, rooms, broadcastToRoom, log);
      }
    });
  });

  function broadcastToRoom(roomId, messageObj, excludeWs = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = JSON.stringify(messageObj);
    for (const client of room.users.keys()) {
      if (client !== excludeWs && client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    }
  }

  // cleanup on server close
  const origClose = wss.close.bind(wss);
  wss.close = function (...args) {
    clock.clearInterval(presenceInterval);
    return origClose(...args);
  };

  log.info("WebSocket real-time server initialized");
  return wss;
}

module.exports = {
  initRealtimeServer,
  validateStateUpdate,
  ALLOWED_ROLES,
  STATE_RULES,
  ACTION_RULES,
  STALE_MS,
  DEAD_MS,
  getRoom: (roomId) => rooms.get(roomId)
};
