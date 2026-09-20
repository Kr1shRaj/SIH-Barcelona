/* global WebSocket */
import { createLogger } from "../../js/logger.js";
import { t } from "../../js/i18n.js";
import { resolveWebSocketUrl } from "../../js/api.js";

const logger = createLogger("TeamSession");

let ws = null;
let currentRoomId = null;
let currentRole = null;
const peers = new Map(); // role -> { position, rotation }
let roomState = {};

const stateChangeListeners = [];
const peerPositionListeners = [];
const peerJoinLeaveListeners = [];
const sessionErrorListeners = [];

// prompt user to join a room
export function promptJoinTeamSession(container) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "team-session-join";
    overlay.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:sans-serif;padding:2rem;";

    overlay.innerHTML = `
      <h2 style="margin-bottom:1rem;color:#f87171;">${t("modules.fire_response.team_join_title", {}, "Join Fire Response Team")}</h2>
      <div style="margin-bottom:1.5rem;width:100%;max-width:300px;">
        <label style="display:block;margin-bottom:0.5rem;">${t("modules.fire_response.room_code", {}, "Room Code")}</label>
        <input type="text" id="ts-room-id" style="width:100%;padding:0.8rem;border-radius:4px;border:none;font-size:1.1rem;text-transform:uppercase;text-align:center;" placeholder="e.g. MINE-123" />
      </div>
      <div style="margin-bottom:2rem;width:100%;max-width:300px;">
        <label style="display:block;margin-bottom:0.5rem;">${t("modules.fire_response.select_role", {}, "Select Your Role")}</label>
        <select id="ts-role" style="width:100%;padding:0.8rem;border-radius:4px;border:none;font-size:1.1rem;">
          <option value="alarm">${t("modules.fire_response.role_alarm", {}, "Alarm Operator")}</option>
          <option value="extinguisher_operator">${t("modules.fire_response.role_extinguisher", {}, "Extinguisher Operator")}</option>
          <option value="backup_coordinator">${t("modules.fire_response.role_backup", {}, "Backup Coordinator")}</option>
        </select>
      </div>
      <button id="ts-join-btn" style="padding:1rem 2rem;background:#ef4444;color:white;border:none;border-radius:4px;font-size:1.2rem;font-weight:bold;cursor:pointer;">${t("modules.fire_response.join_btn", {}, "Join Team")}</button>
      <div id="ts-error" style="color:#fca5a5;margin-top:1rem;height:1.5rem;"></div>
    `;

    container.appendChild(overlay);

    const joinBtn = overlay.querySelector("#ts-join-btn");
    const errorEl = overlay.querySelector("#ts-error");
    const roomInput = overlay.querySelector("#ts-room-id");
    const roleSelect = overlay.querySelector("#ts-role");

    joinBtn.addEventListener("click", () => {
      const roomId = roomInput.value.trim().toUpperCase();
      const role = roleSelect.value;
      if (!roomId) {
        errorEl.textContent = t("fire.team_room_required", "Please enter a room code.");
        return;
      }
      errorEl.textContent = t("fire.team_connecting", "Connecting...");
      joinBtn.disabled = true;

      _connectWebSocket(roomId, role)
        .then(() => {
          overlay.remove();
          resolve(role);
        })
        .catch((err) => {
          errorEl.textContent = err.message || t("fire.team_join_failed", "Failed to join room");
          joinBtn.disabled = false;
        });
    });
  });
}

function _connectWebSocket(roomId, role) {
  return new Promise((resolve, reject) => {
    const wsUrl = resolveWebSocketUrl();
    if (!wsUrl) {
      reject(new Error(t("fire.team_backend_unconfigured", "Backend address is not configured for this device.")));
      return;
    }

    let joined = false;
    
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      reject(err);
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", roomId, role }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "joined") {
          joined = true;
          currentRoomId = msg.roomId;
          currentRole = msg.role;
          roomState = msg.state || {};
          logger.info(`joined team session as ${currentRole}`);
          resolve(); // successful join
        } else if (msg.type === "error") {
          if (!joined) {
            ws.close();
            reject(new Error(msg.message));
          } else {
            const message = msg.message || t("fire.team_state_rejected", "Team action rejected by server.");
            logger.warn({ event: "team_state_update_rejected", message }, "Team server rejected state update");
            sessionErrorListeners.forEach((cb) => cb(message));
          }
        } else if (msg.type === "peer_position") {
          peers.set(msg.role, { position: msg.position, rotation: msg.rotation });
          peerPositionListeners.forEach(cb => cb(msg.role, msg.position, msg.rotation));
        } else if (msg.type === "state_changed") {
          roomState = msg.state;
          stateChangeListeners.forEach(cb => cb(roomState));
        } else if (msg.type === "peer_joined") {
          logger.info(`peer ${msg.role} joined`);
          peerJoinLeaveListeners.forEach(cb => cb(msg.role, "joined"));
        } else if (msg.type === "peer_left") {
          logger.info(`peer ${msg.role} left`);
          peers.delete(msg.role);
          peerJoinLeaveListeners.forEach(cb => cb(msg.role, "left"));
        }
      } catch (err) {
        logger.error(err, "error parsing ws message");
      }
    };

    ws.onerror = () => {
      if (!joined) {
        reject(new Error(t("fire.team_connection_error", "WebSocket connection error")));
      } else {
        const message = t("fire.team_connection_lost", "Team connection lost.");
        logger.warn({ event: "team_connection_error" }, message);
        sessionErrorListeners.forEach((cb) => cb(message));
      }
    };
    
    ws.onclose = () => {
      logger.info("WebSocket disconnected");
      currentRoomId = null;
      currentRole = null;
    };
  });
}

// send minimal marker-relative position
export function sendPositionUpdate(position) {
  if (currentRoomId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "update_position", position }));
  }
}

export function updateRoomState(newStateProps) {
  if (currentRoomId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "state_update", state: newStateProps }));
  }
}

export function getRoomState() {
  return roomState;
}

export function getCurrentRole() {
  return currentRole;
}

export function onStateChange(cb) {
  stateChangeListeners.push(cb);
}

export function onPeerPosition(cb) {
  peerPositionListeners.push(cb);
}

export function onPeerJoinLeave(cb) {
  peerJoinLeaveListeners.push(cb);
}

// let the module show non-fatal server rejections without ending the session
export function onSessionError(cb) {
  if (typeof cb === "function") sessionErrorListeners.push(cb);
}

export function getPeers() {
  return Array.from(peers.keys());
}

// tear down ws and flush listener arrays between sessions
export function resetTeamSession() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  ws = null;
  currentRoomId = null;
  currentRole = null;
  peers.clear();
  roomState = {};
  stateChangeListeners.length = 0;
  peerPositionListeners.length = 0;
  peerJoinLeaveListeners.length = 0;
  sessionErrorListeners.length = 0;
}
