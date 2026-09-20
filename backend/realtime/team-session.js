const { WebSocketServer } = require("ws");
const { getLogger, createChildLogger } = require("../logger");

// simple memory store for rooms and connections
const rooms = new Map(); // roomId -> { users: Map<ws, role>, state: {} }

const ALLOWED_ROLES = ["alarm", "extinguisher_operator", "backup_coordinator"];

function initRealtimeServer(server, config, logger) {
  const wss = new WebSocketServer({ server });
  const log = logger ? logger.child({ component: "team-session" }) : createChildLogger({ component: "team-session" });

  wss.on("connection", (ws) => {
    let currentRoomId = null;
    let currentRole = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        
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
            room.state = { ...room.state, ...data.state };
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
