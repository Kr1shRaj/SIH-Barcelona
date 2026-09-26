const { describe, it } = require("node:test");
const assert = require("node:assert");
const { validateAttemptContract, checkAgainstManifest } = require("../models/attempt");
const { validateModuleManifest, validateModuleManifestList } = require("../models/module");
const { ValidationError, REFERENTIAL, STRUCTURAL } = require("../models/errors");
const { FIXED_NOW, fireAttempt, gasAttempt, manifestRows } = require("./fixtures/attempts");

const AT = { now: FIXED_NOW };

// parse a payload then run it past the manifest, returning the error it raised
function manifestFailure(payload, rows) {
  const attempt = validateAttemptContract(payload, AT);
  try {
    checkAgainstManifest(attempt, rows);
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected manifest check to fail, but it passed");
}

function hasCode(err, code) {
  return err.issues.some((issue) => issue.code === code);
}

// a manifest as GET /api/modules would return it, camelCase wire shape
const FIRE_MANIFEST = {
  moduleId: "fire-response",
  title: "Fire & Explosion Response",
  version: 1,
  passThreshold: 0.7,
  recertMonths: null,
  requiredCheckpoints: [
    { checkpointId: "fire_exit_identification", type: "proximity", weight: 1, required: true, critical: false },
    { checkpointId: "fire_extinguisher_aim", type: "aim", weight: 1, required: true, critical: false },
    { checkpointId: "fire_evacuation_sequence_marker", type: "select", weight: 1, required: true, critical: false }
  ]
};

describe("Manifest validation — referential layer", () => {
  describe("checkAgainstManifest", () => {
    it("passes a fire attempt against the fire manifest", () => {
      const attempt = validateAttemptContract(fireAttempt(), AT);
      assert.doesNotThrow(() => checkAgainstManifest(attempt, manifestRows()));
    });

    it("passes a gas attempt against the full manifest", () => {
      const attempt = validateAttemptContract(gasAttempt(), AT);
      assert.doesNotThrow(() => checkAgainstManifest(attempt, manifestRows()));
    });

    it("works when handed only that module's rows", () => {
      const attempt = validateAttemptContract(fireAttempt(), AT);
      assert.doesNotThrow(() => checkAgainstManifest(attempt, manifestRows("fire-response")));
    });

    it("rejects a module the server holds no manifest for", () => {
      const payload = fireAttempt({ moduleId: "machinery-safety" });
      payload.checkpoints.forEach((c, i) => { c.checkpointId = `machine_step_${i + 1}`; });

      const err = manifestFailure(payload, manifestRows());
      assert.strictEqual(err.kind, REFERENTIAL);
      assert.ok(hasCode(err, "unknown_module"));
    });

    it("rejects an unknown checkpoint id and names it", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].checkpointId = "fire_invented_step";

      const err = manifestFailure(payload, manifestRows());
      assert.strictEqual(err.kind, REFERENTIAL);
      assert.ok(hasCode(err, "unknown_checkpoint"));
      assert.match(err.issues[0].message, /fire_invented_step/);
    });

    it("rejects a checkpoint borrowed from another module", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].checkpointId = "gas_ppe_selection";

      const err = manifestFailure(payload, manifestRows());
      assert.ok(hasCode(err, "unknown_checkpoint"));
    });

    it("rejects a completed attempt that skipped a required checkpoint", () => {
      const payload = fireAttempt();
      payload.checkpoints.pop();

      const err = manifestFailure(payload, manifestRows());
      assert.ok(hasCode(err, "missing_required_checkpoint"));
      assert.match(err.issues[0].message, /fire_g5_post/);
    });

    it("reports every missing checkpoint at once, not just the first", () => {
      const payload = fireAttempt();
      payload.checkpoints = [payload.checkpoints[0]];

      const err = manifestFailure(payload, manifestRows());
      const missing = err.issues.filter((i) => i.code === "missing_required_checkpoint");
      assert.strictEqual(missing.length, 6, "aim, evacuation and the four decision gates");
    });

    it("rejects an observation kind that disagrees with the manifest", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].observation = { kind: "selection_single", selected: "gather_belongings" };

      const err = manifestFailure(payload, manifestRows());
      assert.ok(hasCode(err, "observation_kind_mismatch"));
    });

    // the checkpoint id picks the rule. arTier only narrows, so a client that lies
    // about its tier cannot reach for the other tier's answer key.
    it("rejects a tier 1 checkpoint sent by an attempt claiming tier 2", () => {
      const payload = fireAttempt();
      payload.checkpoints[2].checkpointId = "fire_evacuation_sequence_webxr";
      payload.checkpoints[2].observation.selected = "wind_based_upwind";

      const err = manifestFailure(payload, manifestRows());
      assert.ok(hasCode(err, "checkpoint_tier_mismatch"));
    });

    it("rejects a tier 2 checkpoint sent by an attempt claiming tier 1", () => {
      const payload = fireAttempt({ arTier: 1 });

      const err = manifestFailure(payload, manifestRows());
      assert.ok(hasCode(err, "checkpoint_tier_mismatch"));
    });

    it("accepts the webxr variant from a genuine tier 1 attempt", () => {
      const payload = fireAttempt({ arTier: 1 });
      payload.checkpoints[2].checkpointId = "fire_evacuation_sequence_webxr";
      payload.checkpoints[2].observation.selected = "wind_based_upwind";
      payload.checkpoints[0].observation.trackingSource = "webxr_pose";
      payload.checkpoints[1].observation.trackingSource = "webxr_pose";

      const attempt = validateAttemptContract(payload, AT);
      assert.doesNotThrow(() => checkAgainstManifest(attempt, manifestRows()));
    });

    it("does not demand the other tier's variant of a split checkpoint", () => {
      const payload = fireAttempt();
      const err = (() => {
        const attempt = validateAttemptContract(payload, AT);
        try {
          checkAgainstManifest(attempt, manifestRows());
        } catch (e) {
          return e;
        }
        return null;
      })();
      assert.strictEqual(err, null, "a tier 2 run must not be failed for skipping the tier 1 question");
    });

    it("treats an empty manifest as an unknown module rather than a free pass", () => {
      const attempt = validateAttemptContract(fireAttempt(), AT);
      assert.throws(() => checkAgainstManifest(attempt, []), /no checkpoint manifest/);
      assert.throws(() => checkAgainstManifest(attempt, null), /no checkpoint manifest/);
    });

    it("ignores optional checkpoints when deciding what is missing", () => {
      const rows = manifestRows("fire-response");
      rows.push({
        module_id: "fire-response",
        checkpoint_id: "fire_optional_extra",
        checkpoint_type: "select",
        observation_kind: "selection_single",
        applies_to_tier: null,
        weight: 1,
        required: 0,
        critical: 0
      });

      const attempt = validateAttemptContract(fireAttempt(), AT);
      assert.doesNotThrow(() => checkAgainstManifest(attempt, rows));
    });

    it("returns the attempt unchanged when everything lines up", () => {
      const attempt = validateAttemptContract(fireAttempt(), AT);
      assert.strictEqual(checkAgainstManifest(attempt, manifestRows()), attempt);
    });
  });

  describe("validateModuleManifest", () => {
    it("accepts a well formed manifest", () => {
      const result = validateModuleManifest(FIRE_MANIFEST);
      assert.strictEqual(result.moduleId, "fire-response");
      assert.strictEqual(result.requiredCheckpoints.length, 3);
    });

    it("accepts a null recertMonths, the Mines Act period is still open", () => {
      assert.doesNotThrow(() => validateModuleManifest({ ...FIRE_MANIFEST, recertMonths: null }));
    });

    it("rejects a passThreshold outside 0..1", () => {
      assert.throws(() => validateModuleManifest({ ...FIRE_MANIFEST, passThreshold: 70 }), ValidationError);
    });

    it("rejects a duplicate checkpoint in the manifest", () => {
      const bad = {
        ...FIRE_MANIFEST,
        requiredCheckpoints: [FIRE_MANIFEST.requiredCheckpoints[0], FIRE_MANIFEST.requiredCheckpoints[0]]
      };
      assert.throws(() => validateModuleManifest(bad), /duplicate checkpoint/);
    });

    it("rejects an empty checkpoint list", () => {
      assert.throws(
        () => validateModuleManifest({ ...FIRE_MANIFEST, requiredCheckpoints: [] }),
        ValidationError
      );
    });

    it("rejects an unknown key", () => {
      assert.throws(() => validateModuleManifest({ ...FIRE_MANIFEST, extra: true }), ValidationError);
    });
  });

  describe("validateModuleManifestList", () => {
    it("accepts a list of manifests", () => {
      const result = validateModuleManifestList([FIRE_MANIFEST]);
      assert.strictEqual(result.length, 1);
    });

    it("rejects a non-array", () => {
      try {
        validateModuleManifestList({});
        assert.fail("expected a throw");
      } catch (err) {
        assert.strictEqual(err.kind, STRUCTURAL);
      }
    });

    it("names the index of the bad manifest", () => {
      try {
        validateModuleManifestList([FIRE_MANIFEST, { ...FIRE_MANIFEST, passThreshold: 9 }]);
        assert.fail("expected a throw");
      } catch (err) {
        assert.ok(err.issues.some((i) => i.path.startsWith("1.")), "issue path must carry the index");
      }
    });
  });
});
