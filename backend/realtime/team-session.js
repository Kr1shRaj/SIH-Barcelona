const { WebSocketServer } = require("ws");
const { createChildLogger } = require("../logger");

// simple memory store for rooms and connections
const rooms = new Map(); // roomId -> { users, state, marker, userMeta }

const ALLOWED_ROLES = ["alarm", "extinguisher_operator", "backup_coordinator"];
const STATE_RULES = Object.freeze({
  alarm_pulled: { role: "alarm" },
  fire_extinguished: { role: "extinguisher_operator", requires: "alarm_pulled" },
  evac_checked: { role: "backup_coordinator", requires: "fire_extinguished" }
});

// presence thresholds in ms
const STALE_MS = 5000;
const DEAD_MS = 20000;
const PRESENCE_CHECK_INTERVAL_MS = 1000;

// send one private websocket error to the client that made the bad request
function sendError(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", message }));
}

// validate every state flag before changing room state
function validateStateUpdate(state, role, currentState) {
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
    if (rule.role !== role) return { ok: false, reason: `${role} cannot set ${key}` };
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
  if (room.phase === "guided" || room.phase === "unguided") return true;
  if (room.drillActive === true) return true;
  if (room.state && (room.state.alarm_pulled || room.state.fire_extinguished)) return true;
  return false;
}

// kick user, tell peers, abort drill if mid-action
function removeUser(ws, roomId, role, rooms, broadcastToRoom, log) {
  const room = rooms.get(roomId);
  if (!room) return;

  const hadUser = room.users.has(ws);
  room.users.delete(ws);
  if (room.userMeta) room.userMeta.delete(ws);

  if (hadUser) {
    broadcastToRoom(roomId, { type: "peer_left", role });

    if (isRoomDrillActive(room)) {
      room.phase = "lobby";
      room.drillActive = false;
      room.state = {};
      broadcastToRoom(roomId, { type: "drill_aborted", reason: `${role} disconnected` });
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

function initRealtimeServer(server, config, logger, clockOverride) {
  const wss = new WebSocketServer({ server });
  const log = logger ? logger.child({ component: "team-session" }) : createChildLogger({ component: "team-session" });
  const clock = clockOverride || DEFAULT_CLOCK;

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
          const { roomId, role } = data;
          if (!ALLOWED_ROLES.includes(role)) {
            ws.send(JSON.stringify({ type: "error", message: "invalid role" }));
            return;
          }

          if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: new Map(), state: {}, marker: null, userMeta: new Map() });
          }
          const room = rooms.get(roomId);
          if (!room.userMeta) room.userMeta = new Map();

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
          room.userMeta.set(ws, { role, lastSeen: clock.now(), stale: false });
          currentRoomId = roomId;
          currentRole = role;

          ws.send(JSON.stringify({ type: "joined", roomId, role, state: room.state }));
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
            const result = validateStateUpdate(data.state, currentRole, room.state);
            if (!result.ok) {
              log.warn({
                event: "team_state_update_rejected",
                roomId: currentRoomId,
                role: currentRole,
                reason: result.reason
              }, "Team state update rejected");
              sendError(ws, result.reason);
              return;
            }
            room.state = result.state;
            broadcastToRoom(currentRoomId, { type: "state_changed", state: room.state }, ws);
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

module.exports = { initRealtimeServer, validateStateUpdate, ALLOWED_ROLES, STATE_RULES, STALE_MS, DEAD_MS };
