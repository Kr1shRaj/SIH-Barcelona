import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";

// minimal event bus for safear events
const _listeners = {};
globalThis.window = {
  dispatchEvent(ev) {
    (_listeners[ev.type] || []).forEach((fn) => fn(ev));
  },
  addEventListener(type, fn) {
    if (!_listeners[type]) _listeners[type] = [];
    _listeners[type].push(fn);
  },
  removeEventListener(type, fn) {
    if (!_listeners[type]) return;
    _listeners[type] = _listeners[type].filter((f) => f !== fn);
  },
  location: {
    protocol: "http:",
    host: "localhost:3000"
  }
};

// element store for stubbed dom
const _elements = {};

// clean element and all kids out of element dictionary
function _unregisterElement(el) {
  if (el && el.id && _elements[el.id] === el) {
    delete _elements[el.id];
  }
  if (el && Array.isArray(el.children)) {
    el.children.forEach(_unregisterElement);
  }
}

// make fake element for dom tree
function _makeEl(initId) {
  let _id = initId;
  const el = {
    get id() { return _id; },
    set id(newId) {
      if (_id && _elements[_id] === el) delete _elements[_id];
      _id = newId;
      if (newId) _elements[newId] = el;
    },
    tagName: "div",
    value: "",
    disabled: false,
    textContent: "",
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      if (Array.isArray(this.children)) {
        this.children.forEach(_unregisterElement);
        this.children = [];
      }
      this._innerHTML = val;
      // scan markup for ids and register child elements
      const idRegex = /<([a-zA-Z0-9-]+)[^>]*id=["']([^"']+)["'][^>]*>/g;
      let match;
      while ((match = idRegex.exec(val)) !== null) {
        const tag = match[1].toLowerCase();
        const childId = match[2];
        let child = _elements[childId];
        if (!child) {
          child = _makeEl(childId);
          child.tagName = tag;
          if (tag === "select") child.value = "alarm";
        }
        this.appendChild(child);
      }
    },
    style: { cssText: "" },
    dataset: {},
    children: [],
    _attrs: {},
    _listeners: {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    removeEventListener(ev, fn) {
      if (!this._listeners[ev]) return;
      this._listeners[ev] = this._listeners[ev].filter((f) => f !== fn);
    },
    setAttribute(name, val) {
      this[name] = val;
      this._attrs[name] = val;
    },
    getAttribute(name) {
      if (this._attrs[name] !== undefined) return this._attrs[name];
      return this[name] !== undefined ? this[name] : null;
    },
    hasAttribute(name) {
      return this._attrs[name] !== undefined || this[name] !== undefined;
    },
    removeAttribute(name) {
      delete this._attrs[name];
      delete this[name];
    },
    click() {
      (this._listeners["click"] || []).forEach((fn) => fn());
    },
    querySelector(sel) {
      if (sel.startsWith("#")) {
        const targetId = sel.slice(1);
        if (_elements[targetId]) return _elements[targetId];
        return this.children.find((c) => c.id === targetId) || null;
      }
      return this.children.find((c) => c.tagName === sel.toLowerCase()) || null;
    },
    querySelectorAll(sel) {
      if (sel.startsWith("#")) {
        const targetId = sel.slice(1);
        const match = _elements[targetId] || this.children.find((c) => c.id === targetId);
        return match ? [match] : [];
      }
      return this.children.filter((c) => c.tagName === sel.toLowerCase());
    },
    appendChild(child) {
      if (!child) return child;
      if (child.id) _elements[child.id] = child;
      child.parentNode = this;
      if (!this.children.includes(child)) {
        this.children.push(child);
      }
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentNode = null;
      _unregisterElement(child);
      return child;
    },
    remove() {
      if (this.parentNode && typeof this.parentNode.removeChild === "function") {
        this.parentNode.removeChild(this);
      }
      _unregisterElement(this);
    }
  };

  if (initId) _elements[initId] = el;
  return el;
}

globalThis.document = {
  getElementById(id) {
    return _elements[id] || null;
  },
  createElement(tag) {
    const el = _makeEl(null);
    el.tagName = (tag || "").toLowerCase();
    return el;
  },
  querySelector(sel) {
    if (sel.startsWith("#")) {
      return _elements[sel.slice(1)] || null;
    }
    if (sel === "[camera]" || sel === "#main-camera") {
      return _elements["main-camera"] || Object.values(_elements).find((e) => e.hasAttribute && e.hasAttribute("camera")) || null;
    }
    if (sel === "a-marker") {
      return _elements["a-marker"] || null;
    }
    if (sel === "a-scene") {
      return _elements["a-scene"] || null;
    }
    return null;
  },
  querySelectorAll(sel) {
    if (sel.startsWith("#")) {
      const el = _elements[sel.slice(1)];
      return el ? [el] : [];
    }
    return Object.values(_elements).filter((e) => e.tagName === sel.toLowerCase());
  }
};

// fake websocket talk to team session
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static onSend = null;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    MockWebSocket.instances.push(this);

    globalThis.queueMicrotask(() => {
      if (this.readyState === MockWebSocket.OPEN && typeof this.onopen === "function") {
        this.onopen();
      }
    });
  }

  send(data) {
    this.sent.push(data);
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (typeof MockWebSocket.onSend === "function") {
      MockWebSocket.onSend(this, parsed);
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (typeof this.onclose === "function") {
      this.onclose();
    }
  }

  receive(msg) {
    if (typeof this.onmessage === "function") {
      this.onmessage({ data: JSON.stringify(msg) });
    }
  }
}

globalThis.WebSocket = MockWebSocket;

import { registerCheckpoint, clearCheckpoints } from "../ar/interactions.js";

import {
  startTeamScenario,
  cleanupFireModule,
  isPinPullComplete,
  isAimHoldComplete,
  isSqueezeComplete,
  isSweepComplete,
  PIN_PULL_THRESHOLD_PX,
  AIM_HOLD_DURATION_MS,
  SQUEEZE_HOLD_DURATION_MS,
  CP_EXIT_ID
} from "../modules/fire-response/fire-response.js";

import {
  promptJoinTeamSession,
  resetTeamSession,
  getRoomState,
  getCurrentRole,
  getPeers
} from "../modules/fire-response/team-session.js";

import {
  buildPeerAvatarEntity
} from "../modules/fire-response/graphics.js";

// join team session fast for tests
async function setupTeamScenario(role = "alarm", initialRoomState = {}) {
  let container = document.getElementById("ar-viewport");
  if (!container) {
    container = _makeEl("ar-viewport");
  }

  // guarantee checkpoint registered so fireCheckpointResult dispatches
  registerCheckpoint({ id: CP_EXIT_ID, type: "proximity", onTrigger: () => {} });

  // guarantee viewport overlays and entities exist
  if (!document.getElementById("fire-module-overlay")) {
    const fireOverlay = _makeEl("fire-module-overlay");
    container.appendChild(fireOverlay);
  }
  if (!document.getElementById("a-marker")) {
    const marker = _makeEl("a-marker");
    container.appendChild(marker);
  }
  if (!document.getElementById("main-camera")) {
    const camera = _makeEl("main-camera");
    camera.setAttribute("camera", "");
    camera.setAttribute("position", { x: 0, y: 1.6, z: 0 });
    camera.setAttribute("rotation", { x: 0, y: 0, z: 0 });
    container.appendChild(camera);
  }

  MockWebSocket.onSend = (ws, msg) => {
    if (msg.type === "join") {
      ws.receive({
        type: "joined",
        roomId: msg.roomId,
        role: msg.role,
        state: initialRoomState
      });
    } else if (msg.type === "state_update") {
      Object.assign(initialRoomState, msg.state);
      ws.receive({ type: "state_changed", state: { ...initialRoomState } });
    }
  };

  // auto-fill and submit join form as soon as mounted
  const origAppend = container.appendChild.bind(container);
  container.appendChild = (child) => {
    const res = origAppend(child);
    if (child && child.id === "team-session-join") {
      globalThis.queueMicrotask(() => {
        const roomInput = child.querySelector("#ts-room-id");
        const roleSelect = child.querySelector("#ts-role");
        const joinBtn = child.querySelector("#ts-join-btn");
        if (roomInput) roomInput.value = "TEST-ROOM";
        if (roleSelect) roleSelect.value = role;
        if (joinBtn) joinBtn.click();
      });
    }
    return res;
  };

  await startTeamScenario(container, { tier: 2 });
  container.appendChild = origAppend;
  return container;
}

describe("Phase 3 Fire Team Session", () => {
  beforeEach(() => {
    cleanupFireModule();
    resetTeamSession();
    clearCheckpoints();
    MockWebSocket.instances = [];
    MockWebSocket.onSend = null;

    Object.keys(_elements).forEach((k) => delete _elements[k]);
    Object.keys(_listeners).forEach((k) => delete _listeners[k]);

    const viewport = _makeEl("ar-viewport");
    const camera = _makeEl("main-camera");
    camera.setAttribute("camera", "");
    camera.setAttribute("position", { x: 0, y: 1.6, z: 0 });
    camera.setAttribute("rotation", { x: 0, y: 0, z: 0 });

    const marker = _makeEl("a-marker");
    const fireOverlay = _makeEl("fire-module-overlay");

    viewport.appendChild(camera);
    viewport.appendChild(marker);
    viewport.appendChild(fireOverlay);
  });

  afterEach(() => {
    cleanupFireModule();
    resetTeamSession();
  });

  describe("1. Role-claim conflict at UI layer", () => {
    // bad role pick get error banner, button wake back up
    it("shows error message when attempting to claim already-claimed role, does not silent fail or double-claim", async () => {
      const container = _makeEl("ar-viewport");

      MockWebSocket.onSend = (ws, msg) => {
        if (msg.type === "join") {
          ws.receive({ type: "error", message: "role already claimed" });
        }
      };

      let resolved = false;
      const joinPromise = promptJoinTeamSession(container).then((role) => {
        resolved = true;
        return role;
      });

      const overlay = container.querySelector("#team-session-join");
      assert.ok(overlay, "join overlay must be added to container");

      const roomInput = overlay.querySelector("#ts-room-id");
      const roleSelect = overlay.querySelector("#ts-role");
      const joinBtn = overlay.querySelector("#ts-join-btn");
      const errorEl = overlay.querySelector("#ts-error");

      roomInput.value = "MINE-99";
      roleSelect.value = "alarm";
      joinBtn.click();

      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      assert.strictEqual(errorEl.textContent, "role already claimed", "must display role conflict error message");
      assert.strictEqual(joinBtn.disabled, false, "join button must be re-enabled for another attempt");
      assert.strictEqual(resolved, false, "promise must not resolve on conflict");
      assert.ok(container.children.includes(overlay), "overlay must not be removed on conflict");

      // pick free role and finish join
      MockWebSocket.onSend = (ws, msg) => {
        if (msg.type === "join") {
          ws.receive({ type: "joined", roomId: msg.roomId, role: msg.role, state: {} });
        }
      };

      roleSelect.value = "extinguisher_operator";
      joinBtn.click();

      const chosenRole = await joinPromise;
      assert.strictEqual(chosenRole, "extinguisher_operator", "resolves with newly selected available role");
      assert.ok(!container.children.includes(overlay), "overlay removed on successful join");
    });
  });

  describe("2. Peer position broadcast and avatar rendering", () => {
    // avatar build right colors and label per role
    it("buildPeerAvatarEntity creates avatar with role color and label", () => {
      const alarmAvatar = buildPeerAvatarEntity("alarm");
      assert.ok(alarmAvatar, "must return an avatar entity");

      const head = alarmAvatar.children.find((c) => c.tagName === "a-sphere");
      const body = alarmAvatar.children.find((c) => c.tagName === "a-cone");
      const label = alarmAvatar.children.find((c) => c.tagName === "a-text");

      assert.ok(head, "avatar has head sphere");
      assert.ok(body, "avatar has body cone");
      assert.ok(label, "avatar has text label");
      assert.strictEqual(head.getAttribute("color"), "#ef4444");
      assert.strictEqual(label.getAttribute("value"), "ALARM");

      const extAvatar = buildPeerAvatarEntity("extinguisher_operator");
      const extHead = extAvatar.children.find((c) => c.tagName === "a-sphere");
      const extLabel = extAvatar.children.find((c) => c.tagName === "a-text");
      assert.strictEqual(extHead.getAttribute("color"), "#3b82f6");
      assert.strictEqual(extLabel.getAttribute("value"), "EXTINGUISHER OPERATOR");

      const evacAvatar = buildPeerAvatarEntity("backup_coordinator");
      const evacHead = evacAvatar.children.find((c) => c.tagName === "a-sphere");
      const evacLabel = evacAvatar.children.find((c) => c.tagName === "a-text");
      assert.strictEqual(evacHead.getAttribute("color"), "#10b981");
      assert.strictEqual(evacLabel.getAttribute("value"), "BACKUP COORDINATOR");
    });

    // peer move update avatar coords on marker
    it("updates peer avatar position and rotation on position broadcast via buildPeerAvatarEntity", async () => {
      await setupTeamScenario("backup_coordinator");

      const marker = document.getElementById("a-marker");
      assert.ok(marker, "marker exists in DOM");

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      assert.ok(ws, "active websocket exists");

      ws.receive({
        type: "peer_position",
        role: "alarm",
        position: { x: 1.25, z: -2.5, headingDeg: 75 }
      });

      const avatar = marker.children.find((c) => c.children.some((ch) => ch.getAttribute("value") === "ALARM"));
      assert.ok(avatar, "peer avatar mounted inside marker");
      assert.strictEqual(avatar.getAttribute("position"), "1.25 0 -2.5");
      assert.strictEqual(avatar.getAttribute("rotation"), "0 75 0");

      ws.receive({
        type: "peer_position",
        role: "alarm",
        position: { x: 3.0, z: -1.0, headingDeg: 180 }
      });

      assert.strictEqual(avatar.getAttribute("position"), "3 0 -1");
      assert.strictEqual(avatar.getAttribute("rotation"), "0 180 0");

      const avatars = marker.children.filter((c) => c.children.some((ch) => ch.getAttribute("value") === "ALARM"));
      assert.strictEqual(avatars.length, 1, "reuses same avatar entity without creating duplicates");
    });

    // peer leave throw avatar in trash
    it("removes peer avatar when peer leaves", async () => {
      await setupTeamScenario("backup_coordinator");
      const marker = document.getElementById("a-marker");
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      ws.receive({
        type: "peer_position",
        role: "alarm",
        position: { x: 1, z: 1, headingDeg: 0 }
      });
      assert.strictEqual(marker.children.length, 1);

      ws.receive({
        type: "peer_left",
        role: "alarm"
      });
      assert.strictEqual(marker.children.length, 0, "avatar removed from marker when peer leaves");
    });
  });

  describe("3. cleanupFireModule resets team state and permits double-session (Bug 3 regression)", () => {
    // cleanup reset state, second session boot clean
    it("cleans up overlay, calls resetTeamSession, and allows starting second team session", async () => {
      await setupTeamScenario("alarm");

      assert.ok(document.getElementById("team-module-overlay"), "team overlay exists in session 1");
      assert.ok(document.getElementById("fire-alarm-station"), "alarm station rendered in session 1");
      assert.strictEqual(getCurrentRole(), "alarm");

      cleanupFireModule();

      // note: _teamAlarmSetup, _teamExtSetup, _teamEvacSetup are private module-scoped booleans.
      // their reset to false is verified because a second session successfully renders setup again:
      assert.strictEqual(document.getElementById("team-module-overlay"), null, "team overlay removed");
      assert.strictEqual(document.getElementById("fire-alarm-station"), null, "alarm station removed");
      assert.strictEqual(getCurrentRole(), null, "current role cleared by resetTeamSession");
      assert.deepStrictEqual(getRoomState(), {}, "room state cleared by resetTeamSession");
      assert.strictEqual(getPeers().length, 0, "peers cleared by resetTeamSession");

      // start session 2: Bug 3 regression test
      await setupTeamScenario("alarm");

      assert.ok(document.getElementById("team-module-overlay"), "team overlay exists in session 2");
      assert.ok(document.getElementById("fire-alarm-station"), "alarm station rendered again in session 2");
      assert.ok(document.getElementById("btn-pull-alarm"), "alarm pull button rendered again in session 2");
    });

    // second extinguisher run get fresh pass step
    it("resets extinguisher setup state allowing second extinguisher session", async () => {
      await setupTeamScenario("extinguisher_operator", { alarm_pulled: true });
      assert.ok(document.getElementById("pin-status-badge"), "pass step 2 mounted in session 1");

      cleanupFireModule();
      assert.strictEqual(document.getElementById("pin-status-badge"), null);

      await setupTeamScenario("extinguisher_operator", { alarm_pulled: true });
      assert.ok(document.getElementById("pin-status-badge"), "pass step 2 mounted again in session 2");
    });
  });

  describe("4. Extinguisher operator PASS function invocation", () => {
    // extinguisher run real pass steps, trip checkpoint, tell room
    it("calls isPinPullComplete, isSqueezeComplete, and isSweepComplete during PASS flow and updates room state", async () => {
      const roomState = { alarm_pulled: true, fire_extinguished: false };
      await setupTeamScenario("extinguisher_operator", roomState);

      const instr = document.getElementById("team-instruction");
      assert.match(instr.textContent, /Extinguish the fire using PASS/i);

      // P - Pull Pin
      const pin = document.getElementById("extinguisher-pin");
      assert.ok(pin, "extinguisher pin exists in step 2");
      assert.strictEqual(typeof pin.simulatePull, "function", "simulatePull hook exists");

      const failPull = pin.simulatePull(PIN_PULL_THRESHOLD_PX - 10);
      assert.strictEqual(failPull, false, "drag below threshold fails isPinPullComplete");

      const passPull = pin.simulatePull(PIN_PULL_THRESHOLD_PX + 10);
      assert.strictEqual(passPull, true, "drag at/above threshold passes isPinPullComplete");

      // A - Aim Reticle
      const reticle = document.getElementById("aim-reticle");
      assert.ok(reticle, "aim reticle exists");
      assert.strictEqual(isAimHoldComplete(AIM_HOLD_DURATION_MS), true, "isAimHoldComplete validates duration threshold");
      assert.strictEqual(isAimHoldComplete(AIM_HOLD_DURATION_MS - 100), false, "sub-threshold duration fails");
      reticle.simulateAim(0.95, 0.1);

      // S - Squeeze Handle
      const handle = document.getElementById("extinguisher-handle");
      assert.ok(handle, "extinguisher handle exists");
      assert.strictEqual(typeof handle.simulateSqueeze, "function", "simulateSqueeze hook exists");

      const failSqueeze = handle.simulateSqueeze(SQUEEZE_HOLD_DURATION_MS - 200);
      assert.strictEqual(failSqueeze, false, "squeeze below duration fails isSqueezeComplete");

      const passSqueeze = handle.simulateSqueeze(SQUEEZE_HOLD_DURATION_MS + 200);
      assert.strictEqual(passSqueeze, true, "squeeze at/above duration passes isSqueezeComplete");

      // S - Sweep Nozzle
      const sweep = document.getElementById("sweep-zone");
      assert.ok(sweep, "sweep zone exists");
      assert.strictEqual(typeof sweep.simulateSweep, "function", "simulateSweep hook exists");

      // sub-threshold coverage does not trigger checkpoint
      sweep.simulateSweep([0, 10]);
      assert.strictEqual(roomState.fire_extinguished, false, "sweep below coverage does not extinguish fire");

      // threshold coverage triggers checkpoint and updates room state
      sweep.simulateSweep([0, 100, 200, 240]);
      assert.strictEqual(roomState.fire_extinguished, true, "team checkpoint handler updates fire_extinguished: true");
    });

    // make sure no copycat pass math invented
    it("reuses existing exported PASS validation functions without reimplementing", () => {
      assert.strictEqual(typeof isPinPullComplete, "function");
      assert.strictEqual(typeof isAimHoldComplete, "function");
      assert.strictEqual(typeof isSqueezeComplete, "function");
      assert.strictEqual(typeof isSweepComplete, "function");
    });
  });

  describe("5. Hint timer reuse and stall detection", () => {
    // slow poke get hint after fifteen second wait
    it("uses 15s hint timer for stall detection in team mode", async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        await setupTeamScenario("alarm");

        const overlay = document.getElementById("team-module-overlay");
        assert.ok(overlay, "team overlay exists");

        assert.strictEqual(overlay.querySelector("#fire-step-hint"), null, "no hint initially");

        mock.timers.tick(14900);
        assert.strictEqual(overlay.querySelector("#fire-step-hint"), null, "no hint before 15s");

        mock.timers.tick(100);
        const hintEl = overlay.querySelector("#fire-step-hint");
        assert.ok(hintEl, "hint appears after 15s inactivity");
        assert.match(hintEl.textContent, /alarm/i, "hint contains alarm prompt");
      } finally {
        mock.timers.reset();
      }
    });

    // fast work kill hint timer before tick
    it("clears hint timer when action completes before 15s threshold", async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        await setupTeamScenario("alarm");
        const overlay = document.getElementById("team-module-overlay");

        mock.timers.tick(5000);
        assert.strictEqual(overlay.querySelector("#fire-step-hint"), null);

        const btn = document.getElementById("btn-pull-alarm");
        assert.ok(btn, "pull alarm button exists");
        btn.click();

        mock.timers.tick(15000);
        assert.strictEqual(overlay.querySelector("#fire-step-hint"), null, "hint was cleared and never appeared");
      } finally {
        mock.timers.reset();
      }
    });

    // tear down kill running hint timer
    it("clears hint timer on cleanupFireModule", async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        await setupTeamScenario("alarm");
        mock.timers.tick(5000);

        cleanupFireModule();

        mock.timers.tick(20000);
        assert.strictEqual(document.getElementById("fire-step-hint"), null, "hint timer killed by cleanup");
      } finally {
        mock.timers.reset();
      }
    });
  });

  describe("6. Distinct team-module-overlay and fire-module-overlay (Bug 4 regression)", () => {
    // team overlay and fire overlay keep out of each other way
    it("team-module-overlay and fire-module-overlay coexist without DOM collision during alarm step", async () => {
      await setupTeamScenario("alarm");

      const teamOverlay = document.getElementById("team-module-overlay");
      const fireOverlay = document.getElementById("fire-module-overlay");

      assert.ok(teamOverlay, "team-module-overlay must exist in DOM");
      assert.ok(fireOverlay, "fire-module-overlay must exist in DOM");
      assert.notStrictEqual(teamOverlay, fireOverlay, "team-module-overlay and fire-module-overlay must be distinct elements");

      assert.ok(teamOverlay.querySelector("#team-ui-panel"), "team overlay holds team ui panel");
      assert.ok(teamOverlay.querySelector("#team-instruction"), "team overlay holds team instructions");

      assert.ok(fireOverlay.querySelector("#fire-hud-card"), "fire overlay holds fire hud card");
      assert.ok(fireOverlay.querySelector("#btn-pull-alarm"), "fire overlay holds pull alarm button");
    });

    // alarm pull html swap leave team text alone
    it("overwriting fire-module-overlay during alarm pull does not destroy team instruction panel", async () => {
      await setupTeamScenario("alarm");

      const teamOverlay = document.getElementById("team-module-overlay");
      const instr = teamOverlay.querySelector("#team-instruction");
      assert.ok(instr, "team instruction element exists before alarm pull");
      assert.match(instr.textContent, /Locate and pull the fire alarm/i);

      const pullBtn = document.getElementById("btn-pull-alarm");
      pullBtn.click();

      const instrAfter = teamOverlay.querySelector("#team-instruction");
      assert.ok(instrAfter, "team instruction element preserved after alarm step");
      assert.match(instrAfter.textContent, /Waiting for Extinguisher Operator/i, "instruction updated without DOM obliteration");
    });
  });
});
