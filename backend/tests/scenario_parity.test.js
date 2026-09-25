process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const backend = require("../services/grading/scenario");
const { FIRE_DECISION_ANSWER_KEY, FIRE_GATE_ANSWER_KEYS, FIGHTABLE_FUELS } = require("../db/seed");

const FRONTEND_SCENARIO = pathToFileURL(
  path.join(__dirname, "../../frontend/modules/fire-response/scenario.js")
).href;

// fifty uuids from a fixed walk, never Math.random, so a failure replays exactly
function fixedUuids(count) {
  const next = backend.mulberry32(0x5afea2);
  const hex = (n) => Math.floor(next() * 16 ** n).toString(16).padStart(n, "0");
  return Array.from({ length: count }, () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`);
}

// the phone shows the gas reading and the server grades against it. both roll it
// from the attemptId, so the two copies must agree on every id, byte for byte.
describe("fire scenario parity, phone vs server", () => {
  let frontend = null;

  before(async () => {
    frontend = await import(FRONTEND_SCENARIO);
  });

  it("rolls the identical scenario for fifty fixed attempt ids", () => {
    const ids = fixedUuids(50);
    assert.strictEqual(new Set(ids).size, 50);
    ids.forEach((id) => {
      assert.deepStrictEqual(frontend.scenarioFor(id), backend.scenarioFor(id), `scenario drift on ${id}`);
    });
  });

  it("covers both methane levels in that walk, so the parity is not one sided", () => {
    const levels = new Set(fixedUuids(50).map((id) => backend.scenarioFor(id).methaneLevel));
    assert.deepStrictEqual([...levels].sort(), ["high", "low"]);
  });

  it("keeps every high reading at or above the withdrawal limit and every low one below it", () => {
    fixedUuids(50).forEach((id) => {
      const { methaneLevel, reading } = backend.scenarioFor(id);
      if (methaneLevel === "high") assert.ok(reading >= backend.METHANE_WITHDRAWAL_PCT, `${id} high but read ${reading}`);
      else assert.ok(reading < backend.METHANE_WITHDRAWAL_PCT, `${id} low but read ${reading}`);
    });
  });

  it("agrees on the withdrawal limit, the fuel list and the high methane share", () => {
    assert.strictEqual(frontend.METHANE_WITHDRAWAL_PCT, backend.METHANE_WITHDRAWAL_PCT);
    assert.strictEqual(backend.METHANE_WITHDRAWAL_PCT, 1.25);
    assert.deepStrictEqual([...frontend.FUELS], [...backend.FUELS]);
    assert.strictEqual(frontend.HIGH_METHANE_SHARE, backend.HIGH_METHANE_SHARE);
  });

  it("gives offline feedback from the same decision key the server grades with", () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(frontend.DECISION_ANSWER_KEY)), FIRE_DECISION_ANSWER_KEY);
  });

  it("gives offline feedback from the same gate 2, 3 and 5 keys the server grades with", () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(frontend.GATE_ANSWER_KEYS)), FIRE_GATE_ANSWER_KEYS);
    assert.deepStrictEqual([...frontend.FIGHTABLE_FUELS], FIGHTABLE_FUELS);
  });

  it("has a gate 2 case for every fuel the scenario can roll", () => {
    assert.deepStrictEqual(Object.keys(FIRE_GATE_ANSWER_KEYS.fire_g2_media.cases).sort(), [...backend.FUELS].sort());
  });

  it("refuses to roll a scenario without a real attempt id, on both sides", () => {
    [undefined, null, "", "not-a-uuid"].forEach((bad) => {
      assert.throws(() => backend.scenarioFor(bad), /uuid attemptId/);
      assert.throws(() => frontend.scenarioFor(bad), /uuid attemptId/);
    });
  });
});
