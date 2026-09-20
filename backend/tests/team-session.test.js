const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { WebSocket } = require("ws");
const { initRealtimeServer } = require("../realtime/team-session");

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

    ws1.close();
    ws2.close();
  });

  await t.test("teardown", () => {
    return new Promise((resolve) => {
      wss.close();
      server.close(resolve);
    });
  });
});
