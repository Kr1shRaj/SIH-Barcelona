const { WebSocketServer } = require("ws");
const { createChildLogger } = require("../logger");

// simple memory store for rooms and connections
const rooms = new Map(); // roomId -> { users: Map<ws, role>, state: {} }

const ALLOWED_ROLES = ["alarm", "extinguisher_operator", "backup_coordinator"];
const STATE_RULES = Object.freeze({
  alarm_pulled: { role: "alarm" },
  fire_extinguished: { role: "extinguisher_operator", requires: "alarm_pulled" },
  evac_checked: { role: "backup_coordinator", requires: "fire_extinguished" }
});

// send one private websocket error to the client that made the bad request
function sendError(ws, message) {
  ws.send(JSON.stringify({ type: "error", message }));
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

function initRealtimeServer(server, config, logger) {
  const wss = new WebSocketServer({ server });
  const log = logger ? logger.child({ component: "team-session" }) : createChildLogger({ component: "team-session" });

  wss.on("connection", (ws) => {
    let currentRoomId = null;
    let currentRole = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          sendError(ws, "message must be an object");
          return;
        }
        
        if (data.type === "join") {
          const { roomId, role } = data;
          if (!ALLOWED_ROLES.includes(role)) {
            ws.send(JSON.stringify({ type: "error", message: "invalid role" }));
            return;
          }

          if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: new Map(), state: {} });
          }
          const room = rooms.get(roomId);

          // check if role already claimed in this room
          for (let existingRole of room.users.values()) {
            if (existingRole === role) {
              ws.send(JSON.stringify({ type: "error", message: "role already claimed" }));
              return;
            }
          }

          // join successful
          room.users.set(ws, role);
          currentRoomId = roomId;
          currentRole = role;

          ws.send(JSON.stringify({ type: "joined", roomId, role, state: room.state }));
          log.info({ roomId, role }, "user joined room");
          
          // broadcast to others that someone joined
          broadcastToRoom(roomId, { type: "peer_joined", role }, ws);
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
        const room = rooms.get(currentRoomId);
        if (room) {
          room.users.delete(ws);
          broadcastToRoom(currentRoomId, { type: "peer_left", role: currentRole });
          if (room.users.size === 0) {
            rooms.delete(currentRoomId);
          }
        }
        log.info({ roomId: currentRoomId, role: currentRole }, "user left room");
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

  log.info("WebSocket real-time server initialized");
  return wss;
}

module.exports = { initRealtimeServer };
