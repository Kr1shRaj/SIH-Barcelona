/* global WebSocket */
import { createLogger } from "../../js/logger.js";
import { t } from "../../js/i18n.js";
import { resolveWebSocketUrl } from "../../js/api.js";

const logger = createLogger("TeamSession");

let ws = null;
let currentRoomId = null;
let currentRole = null;
let currentPhase = "lobby";
const peers = new Map(); // role -> { position, rotation }
let roomState = {};

const stateChangeListeners = [];
const peerPositionListeners = [];
const peerJoinLeaveListeners = [];
const sessionErrorListeners = [];
const peerStaleListeners = [];
const drillAbortedListeners = [];
const phaseChangeListeners = [];
const peerActionListeners = [];
const drillResultListeners = [];

// prompt user to join a room
export function promptJoinTeamSession(container, joinOptions = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "team-session-join";
    overlay.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:sans-serif;padding:2rem;";

    overlay.innerHTML = `
      <h2 style="margin-bottom:1rem;color:#f87171;">${t("modules.fire_response.team_join_title", {}, "Join Fire Response Team")}</h2>
      <div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:rgba(245,158,11,0.15);border-left:3px solid #f59e0b;border-radius:4px;font-size:0.8rem;color:#fcd34d;max-width:300px;">${t("fire.team_same_marker", "All devices must scan the SAME printed marker at the SAME size.")}</div>
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

      _connectWebSocket(roomId, role, joinOptions)
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

function _connectWebSocket(roomId, role, joinOptions = {}) {
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
      const joinMsg = { type: "join", roomId, role };
      if (joinOptions.workerId) joinMsg.workerId = joinOptions.workerId;
      if (joinOptions.deviceId) joinMsg.deviceId = joinOptions.deviceId;
      if (joinOptions.locale) joinMsg.locale = joinOptions.locale;
      if (joinOptions.markerId) joinMsg.markerId = joinOptions.markerId;
      if (joinOptions.markerSizeCm) joinMsg.markerSizeCm = joinOptions.markerSizeCm;
      ws.send(JSON.stringify(joinMsg));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "joined") {
          joined = true;
          currentRoomId = msg.roomId;
          currentRole = msg.role;
          roomState = msg.state || {};
          if (msg.phase) currentPhase = msg.phase;
          if (Array.isArray(msg.peers)) {
            msg.peers.forEach(p => peers.set(p, { stale: false }));
          }
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
          peers.set(msg.role, { position: msg.position, rotation: msg.rotation, stale: false });
          peerPositionListeners.forEach(cb => cb(msg.role, msg.position, msg.rotation));
        } else if (msg.type === "peer_stale") {
          logger.info(`peer ${msg.role} stale`);
          const existing = peers.get(msg.role) || {};
          peers.set(msg.role, { ...existing, stale: true });
          peerStaleListeners.forEach(cb => cb(msg.role));
        } else if (msg.type === "drill_aborted") {
          logger.warn({ reason: msg.reason }, "drill aborted");
          drillAbortedListeners.forEach(cb => cb(msg.reason));
        } else if (msg.type === "state_changed") {
          roomState = msg.state;
          stateChangeListeners.forEach(cb => cb(roomState));
        } else if (msg.type === "phase") {
          currentPhase = msg.phase;
          logger.info(`phase changed to ${msg.phase}`);
          phaseChangeListeners.forEach(cb => cb(msg.phase, msg.startedAtMs));
        } else if (msg.type === "peer_action") {
          peerActionListeners.forEach(cb => cb(msg.role, msg.action, msg.status));
        } else if (msg.type === "drill_result") {
          drillResultListeners.forEach(cb => cb(msg));
        } else if (msg.type === "peer_joined") {
          logger.info(`peer ${msg.role} joined`);
          peers.set(msg.role, { stale: false });
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

// heartbeat tells server phone is alive, markerVisible distinguishes tracking
export function sendHeartbeat(markerVisible) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "heartbeat", markerVisible: Boolean(markerVisible) }));
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

// listen when peer drops off radar
export function onPeerStale(cb) {
  if (typeof cb === "function") peerStaleListeners.push(cb);
}

// listen when drill gets cancelled
export function onDrillAborted(cb) {
  if (typeof cb === "function") drillAbortedListeners.push(cb);
}

// tell server player is ready for next drill phase
export function sendReady() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ready" }));
  }
}

// broadcast starting an interaction
export function sendActionStart(action) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "action_start", action }));
  }
}

// broadcast ending an interaction
export function sendActionEnd(action) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "action_end", action }));
  }
}

// listen for server drill phase updates
export function onPhaseChange(cb) {
  if (typeof cb === "function") phaseChangeListeners.push(cb);
}

// listen for teammate action updates
export function onPeerAction(cb) {
  if (typeof cb === "function") peerActionListeners.push(cb);
}

// listen for drill completion result
export function onDrillResult(cb) {
  if (typeof cb === "function") drillResultListeners.push(cb);
}

export function getCurrentPhase() {
  return currentPhase;
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
  currentPhase = "lobby";
  peers.clear();
  roomState = {};
  stateChangeListeners.length = 0;
  peerPositionListeners.length = 0;
  peerJoinLeaveListeners.length = 0;
  sessionErrorListeners.length = 0;
  peerStaleListeners.length = 0;
  drillAbortedListeners.length = 0;
  phaseChangeListeners.length = 0;
  peerActionListeners.length = 0;
  drillResultListeners.length = 0;
}
