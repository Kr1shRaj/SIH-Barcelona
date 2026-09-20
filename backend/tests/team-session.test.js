const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { WebSocket } = require("ws");
const { initRealtimeServer } = require("../realtime/team-session");

// wait for one websocket message of the requested type
function nextMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 1000);
    function onMessage(data) {
      const message = JSON.parse(data);
      if (message.type !== type) return;
      clearTimeout(timer);
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

  await t.test("teardown", () => {
    return new Promise((resolve) => {
      wss.close();
      server.close(resolve);
    });
  });
});
