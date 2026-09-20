const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  scoreTeamDrill,
  calcSpeedPoints,
  PAR_TIME_SEC,
  WEIGHTS
} = require("../services/team-drill/scoring");

describe("Team Drill Scoring Service", () => {
  describe("scoring configuration", () => {
    it("exports frozen par times and weights with expected threshold", () => {
      assert.strictEqual(Object.isFrozen(PAR_TIME_SEC), true);
      assert.strictEqual(Object.isFrozen(WEIGHTS), true);
      assert.strictEqual(WEIGHTS.passThreshold, 80);
      assert.strictEqual(PAR_TIME_SEC.alarm, 10);
      assert.strictEqual(PAR_TIME_SEC.extinguisher_operator, 25);
      assert.strictEqual(PAR_TIME_SEC.backup_coordinator, 15);
    });
  });

  describe("calcSpeedPoints", () => {
    it("awards full points when completed under or at par", () => {
      assert.strictEqual(calcSpeedPoints(5, 10, 20), 20);
      assert.strictEqual(calcSpeedPoints(10, 10, 20), 20);
    });

    it("linearly degrades score between 1x par and 3x par", () => {
      // at 2x par (halfway to 3x par), gets 50% of max points
      const half = calcSpeedPoints(20, 10, 20);
      assert.strictEqual(Math.abs(half - 10) < 1e-6, true);
    });

    it("awards 0 points at or above 3x par or on negative/invalid times", () => {
      assert.strictEqual(calcSpeedPoints(30, 10, 20), 0);
      assert.strictEqual(calcSpeedPoints(50, 10, 20), 0);
      assert.strictEqual(calcSpeedPoints(-5, 10, 20), 0);
    });
  });

  describe("scoreTeamDrill", () => {
    it("scores a perfect run under par with 0 errors as a pass", () => {
      const timeline = [
        { role: "alarm", action: "alarm_pulled", tMs: 5000, accepted: true },
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 20000, accepted: true },
        { role: "backup_coordinator", action: "evac_checked", tMs: 30000, accepted: true }
      ];

      const result = scoreTeamDrill(timeline);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.teamScore, 85); // 60 completion + 25 speed
      assert.strictEqual(result.breakdown.completionScore, 60);
      assert.strictEqual(result.breakdown.speedScore, 25);
      assert.strictEqual(result.breakdown.errorPenalty, 0);
      assert.strictEqual(result.breakdown.errorCount, 0);
      assert.strictEqual(result.perRole.alarm, 85);
      assert.strictEqual(result.perRole.extinguisher_operator, 85);
      assert.strictEqual(result.perRole.backup_coordinator, 85);
    });

    it("degrades speed score on slow actions exceeding par", () => {
      // alarm: par 10s -> took 20s (2x par, 50% of 8.33 speed pts)
      // ext: par 25s -> took 75s (3x par, 0 speed pts)
      // evac: par 15s -> took 45s (3x par, 0 speed pts)
      const timeline = [
        { role: "alarm", action: "alarm_pulled", tMs: 20000, accepted: true },
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 95000, accepted: true },
        { role: "backup_coordinator", action: "evac_checked", tMs: 140000, accepted: true }
      ];

      const result = scoreTeamDrill(timeline);
      assert.strictEqual(result.breakdown.completionScore, 60);
      assert.ok(result.breakdown.speedScore < 10, "speed score severely reduced on slow run");
      assert.ok(result.teamScore < 70, "slow drill drops team score below 70");
      assert.strictEqual(result.passed, false);
    });

    it("penalizes erring role heavily and team moderately on rejected attempts", () => {
      const timeline = [
        // wrong role attempts
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 2000, accepted: false, reason: "prereq" },
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 4000, accepted: false, reason: "prereq" },
        // valid actions
        { role: "alarm", action: "alarm_pulled", tMs: 5000, accepted: true },
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 20000, accepted: true },
        { role: "backup_coordinator", action: "evac_checked", tMs: 30000, accepted: true }
      ];

      const result = scoreTeamDrill(timeline);
      assert.strictEqual(result.breakdown.errorCount, 2);
      // 2 errors * 5 pts = 10 pts total penalty, team absorbs 40% = 4 pts
      assert.strictEqual(result.breakdown.errorPenalty, 4);
      assert.strictEqual(result.breakdown.roleErrors.extinguisher_operator, 2);
      assert.strictEqual(result.breakdown.roleErrors.alarm, 0);

      // extinguisher operator individual penalty is 10pts, so extinguisher score is lower than alarm score
      assert.ok(result.perRole.extinguisher_operator < result.perRole.alarm);
    });

    it("clamps scores to 0-100 even with extreme penalty", () => {
      const timeline = [];
      for (let i = 0; i < 50; i++) {
        timeline.push({ role: "alarm", action: "alarm_pulled", tMs: i * 100, accepted: false });
      }

      const result = scoreTeamDrill(timeline);
      assert.strictEqual(result.teamScore, 0);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.perRole.alarm, 0);
    });

    it("awards partial completion when only subset of actions completed", () => {
      const timeline = [
        { role: "alarm", action: "alarm_pulled", tMs: 5000, accepted: true }
      ];

      const result = scoreTeamDrill(timeline);
      assert.strictEqual(result.breakdown.completionScore, 20); // 1 out of 3 actions
      assert.strictEqual(result.passed, false);
      assert.ok(result.perRole.alarm > result.perRole.extinguisher_operator);
    });

    it("is completely deterministic: identical input yields identical output", () => {
      const timeline = [
        { role: "alarm", action: "alarm_pulled", tMs: 6500, accepted: true },
        { role: "backup_coordinator", action: "evac_checked", tMs: 8000, accepted: false, reason: "early" },
        { role: "extinguisher_operator", action: "fire_extinguished", tMs: 24000, accepted: true },
        { role: "backup_coordinator", action: "evac_checked", tMs: 35000, accepted: true }
      ];

      const run1 = scoreTeamDrill(timeline);
      const run2 = scoreTeamDrill(timeline);

      assert.deepStrictEqual(run1, run2);
    });
  });
});
