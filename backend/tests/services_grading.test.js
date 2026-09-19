process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  gradeCheckpoint,
  parseDefinition,
  GRADING_ERRORS,
  GradingError
} = require("../services/grading");
const { manifestRows, measuredManifestRows, TEST_ONLY_ANGULAR_ERROR_RAD } = require("./fixtures/attempts");

// pull one definition row out of the fixture manifest by id
function definition(checkpointId, overrides) {
  const row = measuredManifestRows()
    .concat(manifestRows())
    .find((r) => r.checkpoint_id === checkpointId);
  return Object.assign({}, row, overrides || {});
}

// the shipped, unmeasured version of a spatial row
function unmeasured(checkpointId) {
  return manifestRows().find((r) => r.checkpoint_id === checkpointId);
}

function aimObservation(overrides) {
  return Object.assign(
    {
      kind: "aim_dwell",
      hitDistanceM: 0.2,
      dwellMs: 900,
      sweepCoverage: 0.8,
      frameCount: 54,
      trackingSource: "arjs_marker"
    },
    overrides || {}
  );
}

function alignObservation(overrides) {
  return Object.assign(
    {
      kind: "spatial_alignment",
      anchorId: "fire_exit_sign",
      angularErrorRad: 0.1,
      dwellMs: 900,
      frameCount: 54,
      trackingSource: "arjs_marker"
    },
    overrides || {}
  );
}

// grab the GradingError a call threw
function refusal(fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof GradingError) return err;
    throw err;
  }
  throw new Error("expected the grader to refuse, but it did not");
}

describe("Grading services", () => {
  describe("dispatch", () => {
    it("refuses an observation kind the definition does not grade", () => {
      const err = refusal(() =>
        gradeCheckpoint({ kind: "selection_single", selected: "x" }, definition("fire_extinguisher_aim"))
      );
      assert.strictEqual(err.code, GRADING_ERRORS.OBSERVATION_KIND_MISMATCH);
      assert.strictEqual(err.checkpointId, "fire_extinguisher_aim");
    });

    it("refuses a definition whose json columns are broken", () => {
      const err = refusal(() =>
        gradeCheckpoint(
          { kind: "selection_single", selected: "x" },
          definition("gas_buddy_procedure", { allowed_values: "{not json" })
        )
      );
      assert.strictEqual(err.code, GRADING_ERRORS.DEFINITION_INVALID);
    });
  });

  describe("selection_single", () => {
    const BUDDY = () => definition("gas_buddy_procedure");

    it("passes the answer the server holds", () => {
      const result = gradeCheckpoint(
        { kind: "selection_single", selected: "standby_outside_with_lifeline" },
        BUDDY()
      );
      assert.deepStrictEqual(result, { score: 1, passed: true, reason: "correct", gradeable: true });
    });

    it("fails a wrong answer from the same list", () => {
      const result = gradeCheckpoint(
        { kind: "selection_single", selected: "both_enter_together" },
        BUDDY()
      );
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
    });

    it("refuses an option the shipped ui cannot produce", () => {
      const err = refusal(() =>
        gradeCheckpoint({ kind: "selection_single", selected: "teleport_out" }, BUDDY())
      );
      assert.strictEqual(err.code, GRADING_ERRORS.VOCABULARY_VIOLATION);
    });

    it("grades each evacuation variant against its own key", () => {
      const marker = gradeCheckpoint(
        { kind: "selection_single", selected: "sound_alarm_then_evacuate" },
        definition("fire_evacuation_sequence_marker")
      );
      const webxr = gradeCheckpoint(
        { kind: "selection_single", selected: "wind_based_upwind" },
        definition("fire_evacuation_sequence_webxr")
      );

      assert.strictEqual(marker.passed, true);
      assert.strictEqual(webxr.passed, true);
    });

    it("will not accept one variant's answer for the other", () => {
      const err = refusal(() =>
        gradeCheckpoint(
          { kind: "selection_single", selected: "wind_based_upwind" },
          definition("fire_evacuation_sequence_marker")
        )
      );
      assert.strictEqual(err.code, GRADING_ERRORS.VOCABULARY_VIOLATION);
    });

    it("refuses a definition with no answer key", () => {
      const err = refusal(() =>
        gradeCheckpoint(
          { kind: "selection_single", selected: "both_enter_together" },
          definition("gas_buddy_procedure", { expected_value: null })
        )
      );
      assert.strictEqual(err.code, GRADING_ERRORS.DEFINITION_INVALID);
    });
  });

  describe("selection_multi — must match evaluatePpeSelection exactly", () => {
    const PPE = () => definition("gas_ppe_selection");

    it("passes every mandatory item and nothing forbidden", () => {
      const result = gradeCheckpoint(
        {
          kind: "selection_multi",
          selected: ["scba_respirator", "multi_gas_detector", "safety_harness"]
        },
        PPE()
      );
      assert.strictEqual(result.score, 1);
      assert.strictEqual(result.passed, true);
    });

    it("gives two thirds credit for one missing item, rounded to 0.67", () => {
      const result = gradeCheckpoint(
        { kind: "selection_multi", selected: ["scba_respirator", "multi_gas_detector"] },
        PPE()
      );
      assert.strictEqual(result.score, 0.67);
      assert.strictEqual(result.passed, false);
      assert.deepStrictEqual(result.missing, ["safety_harness"]);
    });

    it("penalises a forbidden item on top of the missing one", () => {
      const result = gradeCheckpoint(
        { kind: "selection_multi", selected: ["scba_respirator", "multi_gas_detector", "dust_mask"] },
        PPE()
      );
      assert.strictEqual(result.score, 0.33, "(2 - 1) / 3");
      assert.strictEqual(result.passed, false);
      assert.deepStrictEqual(result.forbidden, ["dust_mask"]);
    });

    it("fails a full set that also carries a forbidden item", () => {
      const result = gradeCheckpoint(
        {
          kind: "selection_multi",
          selected: ["scba_respirator", "multi_gas_detector", "safety_harness", "welding_shield"]
        },
        PPE()
      );
      assert.strictEqual(result.score, 0.67, "(3 - 1) / 3");
      assert.strictEqual(result.passed, false);
    });

    it("floors an all forbidden selection at zero rather than going negative", () => {
      const result = gradeCheckpoint(
        { kind: "selection_multi", selected: ["dust_mask", "welding_shield"] },
        PPE()
      );
      assert.strictEqual(result.score, 0);
    });

    it("scores an empty selection zero", () => {
      const result = gradeCheckpoint({ kind: "selection_multi", selected: [] }, PPE());
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
    });

    it("refuses an unknown item", () => {
      const err = refusal(() =>
        gradeCheckpoint({ kind: "selection_multi", selected: ["jetpack"] }, PPE())
      );
      assert.strictEqual(err.code, GRADING_ERRORS.VOCABULARY_VIOLATION);
    });

    it("refuses the same item listed twice", () => {
      const err = refusal(() =>
        gradeCheckpoint(
          { kind: "selection_multi", selected: ["scba_respirator", "scba_respirator"] },
          PPE()
        )
      );
      assert.strictEqual(err.code, GRADING_ERRORS.DUPLICATE_SELECTION);
    });
  });

  describe("aim_dwell boundaries", () => {
    const AIM = (overrides) => definition("fire_extinguisher_aim", overrides);

    it("scores a dead centre hit 1.0", () => {
      const result = gradeCheckpoint(aimObservation({ hitDistanceM: 0 }), AIM());
      assert.strictEqual(result.score, 1);
      assert.strictEqual(result.passed, true);
    });

    it("scores the 0.32m threshold hit exactly 0.6 and passes it", () => {
      const result = gradeCheckpoint(aimObservation({ hitDistanceM: 0.32 }), AIM());
      assert.strictEqual(result.score, 0.6);
      assert.strictEqual(result.passed, true, "the pass mark is inclusive");
    });

    it("fails a hit just outside the threshold", () => {
      const result = gradeCheckpoint(aimObservation({ hitDistanceM: 0.33 }), AIM());
      assert.ok(result.score < 0.6);
      assert.strictEqual(result.passed, false);
    });

    it("scores a hit at the full target width zero", () => {
      const result = gradeCheckpoint(aimObservation({ hitDistanceM: 0.8 }), AIM());
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
    });

    // this is the whole point of the change: a button produces no distance
    it("scores a button fallback zero, never a pass", () => {
      const result = gradeCheckpoint(aimObservation({ hitDistanceM: null }), AIM());
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.reason, "no_aim_sample");
    });

    it("scores a dwell shorter than the floor zero", () => {
      const result = gradeCheckpoint(aimObservation({ dwellMs: 799 }), AIM());
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.reason, "dwell_too_short");
    });

    it("fails an incomplete sweep but keeps the score for the report", () => {
      const result = gradeCheckpoint(aimObservation({ sweepCoverage: 0.5 }), AIM());
      assert.strictEqual(result.score, 0.75);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.reason, "sweep_incomplete");
    });

    it("fails a missing sweep reading when the rule asks for one", () => {
      const result = gradeCheckpoint(aimObservation({ sweepCoverage: null }), AIM());
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.reason, "sweep_incomplete");
    });

    it("refuses an impossible hit distance", () => {
      const err = refusal(() => gradeCheckpoint(aimObservation({ hitDistanceM: 99 }), AIM()));
      assert.strictEqual(err.code, GRADING_ERRORS.IMPLAUSIBLE_OBSERVATION);
    });

    it("refuses gyro only tracking, it may not certify", () => {
      const err = refusal(() =>
        gradeCheckpoint(aimObservation({ trackingSource: "device_orientation" }), AIM())
      );
      assert.strictEqual(err.code, GRADING_ERRORS.TRACKING_SOURCE_NOT_ALLOWED);
    });

    it("refuses an admitted absence of tracking", () => {
      const err = refusal(() => gradeCheckpoint(aimObservation({ trackingSource: "none" }), AIM()));
      assert.strictEqual(err.code, GRADING_ERRORS.TRACKING_SOURCE_NOT_ALLOWED);
    });

    it("accepts a webxr pose", () => {
      const result = gradeCheckpoint(aimObservation({ trackingSource: "webxr_pose" }), AIM());
      assert.strictEqual(result.passed, true);
    });

    it("refuses a dwell reported over too few frames when a floor is set", () => {
      const err = refusal(() =>
        gradeCheckpoint(aimObservation({ frameCount: 2 }), AIM({ min_frame_count: 20 }))
      );
      assert.strictEqual(err.code, GRADING_ERRORS.IMPLAUSIBLE_OBSERVATION);
    });

    it("scores zero when the thresholds are not configured", () => {
      const result = gradeCheckpoint(aimObservation(), AIM({ max_distance_m: null, pass_threshold: null }));
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.reason, "threshold_unconfigured");
      assert.strictEqual(result.gradeable, false);
    });
  });

  describe("spatial_alignment validation", () => {
    const EXIT = (overrides) => definition("fire_exit_identification", overrides);

    it("passes an aim held inside the configured angle", () => {
      const result = gradeCheckpoint(alignObservation({ angularErrorRad: 0 }), EXIT());
      assert.strictEqual(result.score, 1);
      assert.strictEqual(result.passed, true);
    });

    it("passes exactly at the configured angle", () => {
      const result = gradeCheckpoint(
        alignObservation({ angularErrorRad: TEST_ONLY_ANGULAR_ERROR_RAD }),
        EXIT()
      );
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, true, "the boundary is inclusive");
    });

    it("fails an aim wider than the configured angle", () => {
      const result = gradeCheckpoint(
        alignObservation({ angularErrorRad: TEST_ONLY_ANGULAR_ERROR_RAD + 0.1 }),
        EXIT()
      );
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
    });

    // the shipped seed leaves this null on purpose
    it("scores zero and blocks certification while no angle has been measured", () => {
      const result = gradeCheckpoint(alignObservation({ angularErrorRad: 0 }), unmeasured("fire_exit_identification"));
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.gradeable, false);
      assert.strictEqual(result.reason, "not_gradeable");
    });

    it("still scores zero if someone flips gradeable on without measuring the angle", () => {
      const row = Object.assign({}, unmeasured("fire_exit_identification"), { gradeable: 1 });
      const result = gradeCheckpoint(alignObservation({ angularErrorRad: 0 }), row);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.reason, "threshold_unconfigured");
    });

    it("refuses an anchor the checkpoint does not own", () => {
      const err = refusal(() =>
        gradeCheckpoint(alignObservation({ anchorId: "gas_hazard_zone" }), EXIT())
      );
      assert.strictEqual(err.code, GRADING_ERRORS.ANCHOR_MISMATCH);
    });

    it("refuses gyro only tracking", () => {
      const err = refusal(() =>
        gradeCheckpoint(alignObservation({ trackingSource: "device_orientation" }), EXIT())
      );
      assert.strictEqual(err.code, GRADING_ERRORS.TRACKING_SOURCE_NOT_ALLOWED);
    });

    it("scores a short dwell zero when a floor is set", () => {
      const result = gradeCheckpoint(
        alignObservation({ dwellMs: 10 }),
        EXIT({ min_dwell_ms: 800 })
      );
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.reason, "dwell_too_short");
    });
  });

  describe("parseDefinition", () => {
    it("reads json columns into real values", () => {
      const parsed = parseDefinition(definition("gas_ppe_selection"));
      assert.deepStrictEqual(parsed.expectedValue, [
        "scba_respirator",
        "multi_gas_detector",
        "safety_harness"
      ]);
      assert.deepStrictEqual(parsed.forbiddenValues, ["dust_mask", "welding_shield"]);
    });

    it("turns a null forbidden list into an empty one", () => {
      const parsed = parseDefinition(definition("gas_buddy_procedure"));
      assert.deepStrictEqual(parsed.forbiddenValues, []);
    });

    it("refuses to be handed nothing", () => {
      const err = refusal(() => parseDefinition(null));
      assert.strictEqual(err.code, GRADING_ERRORS.DEFINITION_INVALID);
    });
  });
});
