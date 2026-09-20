const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { WebSocket } = require("ws");
const { initRealtimeServer, getRoom, ACTION_RULES } = require("../realtime/team-session");

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

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);

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
    assert.deepStrictEqual(evacState.state, {}, "evac_checked completes guided round and resets flags");

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
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
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

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);

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
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close(resolve);
    });
  });
});

test("Team Drill State Machine Phases and Timeline", async (t) => {
  let server;
  let wss;
  let port;

  await t.test("setup state machine server", () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => res.end());
      wss = initRealtimeServer(server, {}, null);
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  // wait until all three roles say ready
  await t.test("lobby needs all 3 ready before guided phase starts", async () => {
    const roomId = `lobby-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    // first two ready up
    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));

    // third player readies up, triggers guided phase
    const phasePromise = Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);
    backup.ws.send(JSON.stringify({ type: "ready" }));

    const phases = await phasePromise;
    assert.strictEqual(phases[0].phase, "guided");
    assert.strictEqual(phases[1].phase, "guided");
    assert.strictEqual(phases[2].phase, "guided");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // evac finish in guided wipes flags and kicks off unguided
  await t.test("guided to unguided transition resets flags server-side", async () => {
    const roomId = `transition-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);

    // advance through guided flow
    const extAlarm1 = nextMessage(extinguisher.ws, "state_changed");
    const backupAlarm1 = nextMessage(backup.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await Promise.all([extAlarm1, backupAlarm1]);

    const alarmExt1 = nextMessage(alarm.ws, "state_changed");
    const backupExt1 = nextMessage(backup.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    await Promise.all([alarmExt1, backupExt1]);

    const unguidedPhase = nextMessage(alarm.ws, "phase");
    const resetState = nextMessage(alarm.ws, "state_changed");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));

    const phaseMsg = await unguidedPhase;
    assert.strictEqual(phaseMsg.phase, "unguided");

    const resetMsg = await resetState;
    assert.deepStrictEqual(resetMsg.state, {});

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // player cannot roll back flags by sending false
  await t.test("client cannot reset flags directly", async () => {
    const roomId = `no-reset-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await nextMessage(alarm.ws, "phase");

    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await nextMessage(extinguisher.ws, "state_changed");

    // try to revert flag
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: false } }));
    const err = await nextMessage(alarm.ws, "error");
    assert.strictEqual(err.message, "alarm_pulled must be true");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // evac finish in unguided finishes drill and issues results
  await t.test("unguided to complete issues drill result", async () => {
    const roomId = `complete-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);

    // complete guided
    const ext1 = nextMessage(extinguisher.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await ext1;

    const alarm1 = nextMessage(alarm.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    await alarm1;

    const unguidedAlarm = nextMessage(alarm.ws, "phase");
    const unguidedExt = nextMessage(extinguisher.ws, "phase");
    const unguidedBackup = nextMessage(backup.ws, "phase");
    const resetAlarm = nextMessage(alarm.ws, "state_changed");
    const resetExt = nextMessage(extinguisher.ws, "state_changed");
    const resetBackup = nextMessage(backup.ws, "state_changed");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
    await Promise.all([unguidedAlarm, unguidedExt, unguidedBackup, resetAlarm, resetExt, resetBackup]);

    // unguided round
    const ext2 = nextMessage(extinguisher.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await ext2;

    const alarm2 = nextMessage(alarm.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    await alarm2;

    const completePhase = nextMessage(alarm.ws, "phase");
    const drillResult = nextMessage(alarm.ws, "drill_result");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));

    const phaseMsg = await completePhase;
    assert.strictEqual(phaseMsg.phase, "complete");

    const resultMsg = await drillResult;
    assert.strictEqual(resultMsg.type, "drill_result");
    assert.strictEqual(resultMsg.passed, true);

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // timeline keeps log of rejected moves with reason
  await t.test("timeline records rejects on bad role or sequence", async () => {
    const roomId = `timeline-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await nextMessage(alarm.ws, "phase");

    // wrong role tries action
    backup.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    const err = await nextMessage(backup.ws, "error");
    assert.strictEqual(err.message, "backup_coordinator cannot set alarm_pulled");

    const room = getRoom(roomId);
    assert.ok(room.timeline.guided.length > 0);
    const reject = room.timeline.guided.find((entry) => entry.accepted === false);
    assert.ok(reject);
    assert.strictEqual(reject.role, "backup_coordinator");
    assert.strictEqual(reject.reason, "backup_coordinator cannot set alarm_pulled");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // dropping during active run kicks back to lobby
  await t.test("abort paths reset phase and state to lobby", async () => {
    const roomId = `abort-path-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await nextMessage(alarm.ws, "phase");

    const abortMsgPromise = nextMessage(alarm.ws, "drill_aborted");
    const lobbyPhasePromise = nextMessage(alarm.ws, "phase");
    await closeSocket(extinguisher.ws);

    const abortMsg = await abortMsgPromise;
    assert.ok(abortMsg.reason.includes("extinguisher_operator"));

    const phaseMsg = await lobbyPhasePromise;
    assert.strictEqual(phaseMsg.phase, "lobby");

    await Promise.all([closeSocket(alarm.ws), closeSocket(backup.ws)]);
  });

  // all ready after complete returns to fresh lobby
  await t.test("fresh drill after complete clears timeline and resets to lobby", async () => {
    const roomId = `fresh-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      nextMessage(alarm.ws, "phase"),
      nextMessage(extinguisher.ws, "phase"),
      nextMessage(backup.ws, "phase")
    ]);

    // complete guided
    const ext1 = nextMessage(extinguisher.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await ext1;

    const alarm1 = nextMessage(alarm.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    await alarm1;

    const unguidedPhase = nextMessage(alarm.ws, "phase");
    const resetState = nextMessage(alarm.ws, "state_changed");
    const unguidedExt = nextMessage(extinguisher.ws, "phase");
    const resetExt = nextMessage(extinguisher.ws, "state_changed");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
    await Promise.all([unguidedPhase, resetState, unguidedExt, resetExt]);

    // complete unguided
    const ext2 = nextMessage(extinguisher.ws, "state_changed");
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    await ext2;

    const alarm2 = nextMessage(alarm.ws, "state_changed");
    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    await alarm2;

    const completePhase = nextMessage(alarm.ws, "phase");
    backup.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
    await completePhase;

    // all 3 send ready again to return to fresh drill lobby
    const lobbyPromise = nextMessage(alarm.ws, "phase");
    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));

    const lobbyMsg = await lobbyPromise;
    assert.strictEqual(lobbyMsg.phase, "lobby");

    const room = getRoom(roomId);
    assert.deepStrictEqual(room.state, {});
    assert.strictEqual(room.timeline.guided.length, 0);
    assert.strictEqual(room.timeline.unguided.length, 0);

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // cannot double-start an action already in motion
  await t.test("duplicate action_start rejected", async () => {
    const roomId = `action-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));
    await nextMessage(alarm.ws, "phase");

    // first start succeeds
    const peerActionPromise = nextMessage(extinguisher.ws, "peer_action");
    alarm.ws.send(JSON.stringify({ type: "action_start", action: "fire_alarm" }));
    const peerAction = await peerActionPromise;
    assert.strictEqual(peerAction.role, "alarm");
    assert.strictEqual(peerAction.action, "fire_alarm");
    assert.strictEqual(peerAction.status, "started");

    // second duplicate start rejected
    alarm.ws.send(JSON.stringify({ type: "action_start", action: "fire_alarm" }));
    const err = await nextMessage(alarm.ws, "error");
    assert.ok(err.message.includes("already started"));

    // wrong role start rejected and names owner
    backup.ws.send(JSON.stringify({ type: "action_start", action: "fire_alarm" }));
    const wrongRoleErr = await nextMessage(backup.ws, "error");
    assert.strictEqual(wrongRoleErr.message, "alarm role owns fire_alarm; you are backup_coordinator");

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws), closeSocket(backup.ws)]);
  });

  // contract test: client action names are subset of server ACTION_RULES keys
  await t.test("contract: client action names subset of ACTION_RULES keys", () => {
    const clientActionNames = ["fire_alarm", "fire_extinguisher", "evacuation_check"];
    const serverActionRulesKeys = Object.keys(ACTION_RULES);
    for (const name of clientActionNames) {
      assert.ok(
        serverActionRulesKeys.includes(name),
        `client action name "${name}" must exist in server ACTION_RULES (${serverActionRulesKeys.join(", ")})`
      );
    }
  });

  // 2-player alarm + extinguisher starts guided with role doubling
  await t.test("2-player mode: alarm + extinguisher starts with role doubling", async () => {
    const roomId = `twoplayer-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const extinguisher = await joinRoom(port, roomId, "extinguisher_operator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    extinguisher.ws.send(JSON.stringify({ type: "ready" }));

    const phaseMsg = await nextMessage(alarm.ws, "phase");
    assert.strictEqual(phaseMsg.type, "phase");
    assert.strictEqual(phaseMsg.phase, "guided");
    assert.deepStrictEqual(phaseMsg.roleDoubling, { backup_coordinator: "alarm" });

    const room = getRoom(roomId);
    assert.deepStrictEqual(room.roleDoubling, { backup_coordinator: "alarm" });

    // alarm player can execute both alarm and backup coordinator actions
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { alarm_pulled: true } }));
    const st1 = await nextMessage(extinguisher.ws, "state_changed");
    assert.strictEqual(st1.state.alarm_pulled, true);

    extinguisher.ws.send(JSON.stringify({ type: "state_update", state: { fire_extinguished: true } }));
    const st2 = await nextMessage(alarm.ws, "state_changed");
    assert.strictEqual(st2.state.fire_extinguished, true);

    // doubled alarm player completes evac_checked and advances to unguided
    alarm.ws.send(JSON.stringify({ type: "state_update", state: { evac_checked: true } }));
    const unguidedPhase = await nextMessage(alarm.ws, "phase");
    assert.strictEqual(unguidedPhase.phase, "unguided");
    assert.deepStrictEqual(unguidedPhase.roleDoubling, { backup_coordinator: "alarm" });

    await Promise.all([closeSocket(alarm.ws), closeSocket(extinguisher.ws)]);
  });

  // invalid 2-player pairings do not start
  await t.test("2-player mode: invalid pairing does not start", async () => {
    const roomId = `invalid-two-room-${Date.now()}`;
    const alarm = await joinRoom(port, roomId, "alarm");
    const backup = await joinRoom(port, roomId, "backup_coordinator");

    alarm.ws.send(JSON.stringify({ type: "ready" }));
    backup.ws.send(JSON.stringify({ type: "ready" }));

    // wait a brief moment, ensure no phase message sent
    const phasePromise = nextMessage(alarm.ws, "phase");
    await assert.rejects(phasePromise, /timed out waiting for phase/);

    const room = getRoom(roomId);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.roleDoubling, null);

    await Promise.all([closeSocket(alarm.ws), closeSocket(backup.ws)]);
  });

  await t.test("teardown state machine server", () => {
    return new Promise((resolve) => {
      wss.close();
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close(resolve);
    });
  });
});
