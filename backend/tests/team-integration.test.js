const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { WebSocket } = require("ws");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { testKeys } = require("./fixtures/certs");
const { initRealtimeServer } = require("../realtime/team-session");

// wait for one websocket message of requested type
function nextMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = global.setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 3000);
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

// close websocket cleanly
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

// open websocket and send join payload
async function joinRoom(port, roomId, role, workerId) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once("open", resolve));
  const payload = { type: "join", roomId, role };
  if (workerId !== undefined) payload.workerId = workerId;
  ws.send(JSON.stringify(payload));
  return ws;
}

test("Team Drill Full Integration: attempts and certs", async (t) => {
  let ctx;
  let server;
  let wss;
  let port;
  const keys = testKeys();

  await t.test("setup", async () => {
    ctx = buildTestApp();
    server = http.createServer(ctx.app);
    wss = initRealtimeServer(server, {}, null, { db: ctx.db, keys });
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  await t.test("worker identity validation on join", async () => {
    const roomId = `auth-room-${Date.now()}`;

    // join without workerId rejected
    const wsNoWorker = await joinRoom(port, roomId, "alarm", undefined);
    const errNoWorker = await nextMessage(wsNoWorker, "error");
    assert.strictEqual(errNoWorker.message, "workerId required");
    await closeSocket(wsNoWorker);

    // join with unknown worker rejected
    const wsUnknown = await joinRoom(port, roomId, "alarm", "WRK-9999");
    const errUnknown = await nextMessage(wsUnknown, "error");
    assert.strictEqual(errUnknown.message, "unknown worker");
    await closeSocket(wsUnknown);

    // join with valid worker accepted
    const ws1 = await joinRoom(port, roomId, "alarm", "WRK-0001");
    const joined1 = await nextMessage(ws1, "joined");
    assert.strictEqual(joined1.role, "alarm");

    // duplicate worker in same room rejected
    const wsDup = await joinRoom(port, roomId, "extinguisher_operator", "WRK-0001");
    const errDup = await nextMessage(wsDup, "error");
    assert.strictEqual(errDup.message, "worker already in room");
    await closeSocket(wsDup);

    await closeSocket(ws1);
  });

  await t.test("passing drill creates per-worker attempts and issues verifiable certs", async () => {
    const roomId = `pass-room-${Date.now()}`;
    let wsAlarm;
    let wsExt;
    let wsEvac;

    try {
      wsAlarm = await joinRoom(port, roomId, "alarm", "WRK-0001");
      await nextMessage(wsAlarm, "joined");

      wsExt = await joinRoom(port, roomId, "extinguisher_operator", "WRK-0002");
      await nextMessage(wsExt, "joined");

      wsEvac = await joinRoom(port, roomId, "backup_coordinator", "WRK-0003");
      await nextMessage(wsEvac, "joined");

      // ready up to start guided phase
      const pGuidedAlarm = nextMessage(wsAlarm, "phase");
      const pGuidedExt = nextMessage(wsExt, "phase");
      const pGuidedEvac = nextMessage(wsEvac, "phase");

      wsAlarm.send(JSON.stringify({ type: "ready" }));
      wsExt.send(JSON.stringify({ type: "ready" }));
      wsEvac.send(JSON.stringify({ type: "ready" }));

      const [g1, g2, g3] = await Promise.all([pGuidedAlarm, pGuidedExt, pGuidedEvac]);
      assert.strictEqual(g1.phase, "guided");
      assert.strictEqual(g2.phase, "guided");
      assert.strictEqual(g3.phase, "guided");

      // complete guided phase actions
      const pUnguidedAlarm = nextMessage(wsAlarm, "phase");
      const pUnguidedExt = nextMessage(wsExt, "phase");
      const pUnguidedEvac = nextMessage(wsEvac, "phase");

      wsAlarm.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
      wsExt.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
      wsEvac.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));

      const [u1, u2, u3] = await Promise.all([pUnguidedAlarm, pUnguidedExt, pUnguidedEvac]);
      assert.strictEqual(u1.phase, "unguided");
      assert.strictEqual(u2.phase, "unguided");
      assert.strictEqual(u3.phase, "unguided");

      // complete unguided actions in order with action_start / action_end
      const pResultAlarm = nextMessage(wsAlarm, "drill_result");
      const pResultExt = nextMessage(wsExt, "drill_result");
      const pResultEvac = nextMessage(wsEvac, "drill_result");

      wsAlarm.send(JSON.stringify({ type: "action_start", action: "fire_alarm" }));
      wsAlarm.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
      wsAlarm.send(JSON.stringify({ type: "action_end", action: "fire_alarm" }));

      wsExt.send(JSON.stringify({ type: "action_start", action: "fire_extinguisher" }));
      wsExt.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
      wsExt.send(JSON.stringify({ type: "action_end", action: "fire_extinguisher" }));

      wsEvac.send(JSON.stringify({ type: "action_start", action: "evacuation_check" }));
      wsEvac.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
      wsEvac.send(JSON.stringify({ type: "action_end", action: "evacuation_check" }));

      const [resAlarm, resExt, resEvac] = await Promise.all([pResultAlarm, pResultExt, pResultEvac]);
      assert.strictEqual(resAlarm.passed, true);
      assert.strictEqual(resExt.passed, true);
      assert.strictEqual(resEvac.passed, true);
      assert.ok(resAlarm.teamScore >= 80);

      // assert per-worker attempts in drill_result
      const attempts = resAlarm.attempts;
      assert.ok(attempts, "attempts map present in drill_result");
      assert.ok(attempts.alarm, "alarm attemptId present");
      assert.ok(attempts.extinguisher_operator, "extinguisher attemptId present");
      assert.ok(attempts.backup_coordinator, "evac attemptId present");

      // verify attempts exist in database
      const selectAttempt = ctx.db.prepare("SELECT * FROM attempt WHERE attempt_id = ?");
      for (const role of ["alarm", "extinguisher_operator", "backup_coordinator"]) {
        const row = selectAttempt.get(attempts[role]);
        assert.ok(row, `attempt row exists for ${role}`);
        assert.strictEqual(row.module_id, "fire-response-team");
        assert.strictEqual(row.server_passed, 1);
        assert.strictEqual(row.grading_status, "graded");
        assert.strictEqual(row.contract_version, "2.0");

        // issue certificate for this attempt
        const issueRes = await request(ctx.app)
          .post("/api/certs/issue")
          .send({ attemptId: attempts[role] });
        assert.strictEqual(issueRes.status, 201);
        assert.ok(issueRes.body.certId);
        assert.ok(issueRes.body.qr);

        // verify certificate online and offline
        const verifyRes = await request(ctx.app)
          .post("/api/certs/verify")
          .send({ qr: issueRes.body.qr });
        assert.strictEqual(verifyRes.status, 200);
        assert.strictEqual(verifyRes.body.verdict, "valid");
        assert.ok(verifyRes.body.certificate);
        assert.strictEqual(verifyRes.body.certificate.workerId, row.worker_id);
        assert.strictEqual(verifyRes.body.certificate.moduleId, "fire-response-team");
      }
    } finally {
      if (wsAlarm) await closeSocket(wsAlarm);
      if (wsExt) await closeSocket(wsExt);
      if (wsEvac) await closeSocket(wsEvac);
    }
  });

  await t.test("failing drill creates no attempts and allows retry", async () => {
    const roomId = `fail-room-${Date.now()}`;
    let wsAlarm;
    let wsExt;
    let wsEvac;

    try {
      wsAlarm = await joinRoom(port, roomId, "alarm", "WRK-0004");
      await nextMessage(wsAlarm, "joined");

      wsExt = await joinRoom(port, roomId, "extinguisher_operator", "WRK-0005");
      await nextMessage(wsExt, "joined");

      wsEvac = await joinRoom(port, roomId, "backup_coordinator", "WRK-0006");
      await nextMessage(wsEvac, "joined");

      wsAlarm.send(JSON.stringify({ type: "ready" }));
      wsExt.send(JSON.stringify({ type: "ready" }));
      wsEvac.send(JSON.stringify({ type: "ready" }));

      await nextMessage(wsAlarm, "phase");

      // complete guided
      wsAlarm.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
      wsExt.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
      wsEvac.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));

      await nextMessage(wsAlarm, "phase");

      // unguided: commit many errors (wrong role or out-of-order attempts) to sink team score
      for (let i = 0; i < 10; i++) {
        wsEvac.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
        await nextMessage(wsEvac, "error");
      }

      const pResult = nextMessage(wsAlarm, "drill_result");

      // now fulfill sequence so it finishes but with negative/low score
      wsAlarm.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
      wsExt.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
      wsEvac.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));

      const res = await pResult;
      assert.strictEqual(res.passed, false);
      assert.ok(res.teamScore < 80);
      assert.deepStrictEqual(res.attempts, {});

      // verify no attempts created in db for these workers in fire-response-team
      const checkAttempt = ctx.db.prepare("SELECT * FROM attempt WHERE worker_id = ? AND module_id = 'fire-response-team'");
      assert.strictEqual(checkAttempt.all("WRK-0004").length, 0);
      assert.strictEqual(checkAttempt.all("WRK-0005").length, 0);
      assert.strictEqual(checkAttempt.all("WRK-0006").length, 0);

      // retry: all 3 send ready to reset to lobby
      const pLobby = nextMessage(wsAlarm, "phase");
      wsAlarm.send(JSON.stringify({ type: "ready" }));
      wsExt.send(JSON.stringify({ type: "ready" }));
      wsEvac.send(JSON.stringify({ type: "ready" }));

      const l = await pLobby;
      assert.strictEqual(l.phase, "lobby");
    } finally {
      if (wsAlarm) await closeSocket(wsAlarm);
      if (wsExt) await closeSocket(wsExt);
      if (wsEvac) await closeSocket(wsEvac);
    }
  });

  await t.test("teardown", async () => {
    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (ctx) ctx.cleanup();
  });
});
