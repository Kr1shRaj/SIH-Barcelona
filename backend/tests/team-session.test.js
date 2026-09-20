const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { WebSocket } = require("ws");
const { initRealtimeServer } = require("../realtime/team-session");

// wait for one websocket message of the requested type
function nextMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = global.setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 1000);
    function onMessage(data) {
      const message = JSON.parse(data);
      if (message.type !== type) return;
      global.clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(message);
    }
    ws.on("message", onMessage);
  });
}

// close websocket and wait for server release
function closeSocket(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", resolve);
    ws.close();
  });
}

// open websocket and claim one role
async function joinRoom(port, roomId, role) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", roomId, role }));
  const joined = await nextMessage(ws, "joined");
  return { ws, joined };
}

test("Team Session Realtime Server", async (t) => {
  let server;
  let wss;
  let port;

  await t.test("setup", () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => res.end());
      wss = initRealtimeServer(server, {}, null);
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  await t.test("should allow valid roles to join and reject duplicates", async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve) => ws1.on("open", resolve));
    await new Promise((resolve) => ws2.on("open", resolve));

    // Client 1 joins as alarm
    ws1.send(JSON.stringify({ type: "join", roomId: "test-room", role: "alarm" }));
    const msg1 = await new Promise((resolve) => {
      ws1.once("message", (data) => resolve(JSON.parse(data)));
    });
    assert.strictEqual(msg1.type, "joined");
    assert.strictEqual(msg1.role, "alarm");

    // Client 2 tries to join as alarm (should fail)
    ws2.send(JSON.stringify({ type: "join", roomId: "test-room", role: "alarm" }));
    const msg2 = await new Promise((resolve) => {
      ws2.once("message", (data) => resolve(JSON.parse(data)));
    });
    assert.strictEqual(msg2.type, "error");
    assert.strictEqual(msg2.message, "role already claimed");

    // Client 2 joins as extinguisher_operator
    ws2.send(JSON.stringify({ type: "join", roomId: "test-room", role: "extinguisher_operator" }));
    const msg3 = await new Promise((resolve) => {
      ws2.once("message", (data) => resolve(JSON.parse(data)));
    });
    assert.strictEqual(msg3.type, "joined");
    assert.strictEqual(msg3.role, "extinguisher_operator");

    await Promise.all([closeSocket(ws1), closeSocket(ws2)]);
  });

  await t.test("validates state role, order, shape, and private errors", async () => {
    const roomId = `state-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    assert.strictEqual((await nextMessage(extinguisher.ws, "error")).message, "extinguisher_operator cannot set alarm_pulled");

    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    assert.strictEqual((await nextMessage(extinguisher.ws, "error")).message, "fire_extinguished requires alarm_pulled");

    alarm.ws.send(JSON.stringify({ type: "state_update", state: { unknown_flag: true } }));
    assert.strictEqual((await nextMessage(alarm.ws, "error")).message, "unknown team state");

    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: false } }));
    assert.strictEqual((await nextMessage(alarm.ws, "error")).message, "alarm_pulled must be true");

    const alarmExtState = nextMessage(extinguisher.ws, "state_changed");
    const alarmBackupState = nextMessage(backup.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    const [alarmState] = await Promise.all([alarmExtState, alarmBackupState]);
    assert.deepStrictEqual(alarmState.state, { alarm_pulled: true }, "rejected updates must not mutate room state");

    const fireBackupState = nextMessage(backup.ws, "state_changed");
    const fireAlarmState = nextMessage(alarm.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    const [fireState] = await Promise.all([fireBackupState, fireAlarmState]);
    assert.deepStrictEqual(fireState.state, { alarm_pulled: true, fire_extinguished: true });

    const evacAlarmState = nextMessage(alarm.ws, "state_changed");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
    const evacState = await evacAlarmState;
    assert.deepStrictEqual(evacState.state, {
      alarm_pulled: true,
      fire_extinguished: true,
      evac_checked: true
    });

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  await t.test("refuses second joiner with different marker config", async () => {
    const roomId = `marker-room-${Date.now()}`;
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws1.on("open", resolve));
    await new Promise((resolve) => ws2.on("open", resolve));

    // first joiner sets marker
    ws1.send(JSON.stringify({ type: "join", roomId, role: "alarm", markerId: "hiro", markerSizeCm: 16 }));
    const joined = await nextMessage(ws1, "joined");
    assert.strictEqual(joined.type, "joined");

    // second joiner with different marker gets refused
    ws2.send(JSON.stringify({ type: "join", roomId, role: "extinguisher_operator", markerId: "kanji", markerSizeCm: 16 }));
    const err = await nextMessage(ws2, "error");
    assert.strictEqual(err.message, "different marker");

    // same marker passes
    const ws3 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws3.on("open", resolve));
    ws3.send(JSON.stringify({ type: "join", roomId, role: "extinguisher_operator", markerId: "hiro", markerSizeCm: 16 }));
    const joined3 = await nextMessage(ws3, "joined");
    assert.strictEqual(joined3.type, "joined");

    await Promise.all([closeSocket(ws1), closeSocket(ws2), closeSocket(ws3)]);
  });

  await t.test("teardown", () => {
    return new Promise((resolve) => {
      wss.close();
      server.close(resolve);
    });
  });
});

test("Team Session Presence with Fake Clock", async (t) => {
  let server;
  let wss;
  let port;
  let fakeNow = 1000;
  let presenceCheckFn = null;

  const fakeClock = {
    now: () => fakeNow,
    setInterval: (fn) => {
      presenceCheckFn = fn;
      return 101;
    },
    clearInterval: () => {
      presenceCheckFn = null;
    },
    setTimeout: (fn, ms) => global.setTimeout(fn, ms),
    clearTimeout: (id) => global.clearTimeout(id)
  };

  await t.test("setup fake clock server", () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => res.end());
      wss = initRealtimeServer(server, {}, null, fakeClock);
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  // mark peer stale after 5s silence
  await t.test("marks peer stale after 5s silent", async () => {
    const roomId = `stale-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");

    const stalePromise = nextMessage(extinguisher.ws, "peer_stale");
    fakeNow += 5000;
    presenceCheckFn();

    const staleMsg = await stalePromise;
    assert.strictEqual(staleMsg.role, "alarm");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws)]);
  });

  // kick dead peer after 20s and free role
  await t.test("removes user after 20s silent and frees role", async () => {
    const roomId = `dead-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");

    const leftPromise = nextMessage(extinguisher.ws, "peer_left");
    fakeNow += 20000;
    presenceCheckFn();

    const leftMsg = await leftPromise;
    assert.strictEqual(leftMsg.role, "alarm");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws)]);
  });

  // only let newcomer steal seat if old player went dead or stale
  await t.test("allows reclaim only when old socket is dead or stale", async () => {
    const roomId = `reclaim-room-${Date.now()}`;
    const alarm1 = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");

    // while alarm1 is fresh, reclaim refused
    const wsFail = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => wsFail.once("open", resolve));
    wsFail.send(JSON.stringify({ type: "join", roomId, role: "alarm" }));
    const err = await nextMessage(wsFail, "error");
    assert.strictEqual(err.message, "role already claimed");
    await closeSocket(wsFail);

    // make alarm1 stale
    fakeNow += 5000;
    presenceCheckFn();

    // now reclaim allowed
    const wsSuccess = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => wsSuccess.once("open", resolve));
    wsSuccess.send(JSON.stringify({ type: "join", roomId, role: "alarm" }));
    const joined = await nextMessage(wsSuccess, "joined");
    assert.strictEqual(joined.role, "alarm");

    await Promise.all([closeSocket(alarm1.ws), closeSocket(wsSuccess), closeSocket(extinguisher.ws)]);
  });

  // drop mid drill aborts run and kicks back to lobby
  await t.test("aborts active drill back to lobby when role is lost", async () => {
    const roomId = `abort-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    // alarm starts drill
    const statePromise = nextMessage(extinguisher.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await statePromise;

    // extinguisher drops mid-drill
    const abortPromise = nextMessage(backup.ws, "drill_aborted");
    await closeSocket(extinguisher.ws);

    const abortMsg = await abortPromise;
    assert.ok(abortMsg.reason.includes("extinguisher_operator"));

    await Promise.all([closeSocket(alarm.ws), closeSocket(backup.ws)]);
  });

  await t.test("teardown fake clock server", () => {
    return new Promise((resolve) => {
      wss.close();
      server.close(resolve);
    });
  });
});
