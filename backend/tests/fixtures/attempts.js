// Golden payloads copied from the SafeAR Attempt Contract v2.0.
// Both sides of the integration point at these. Do not drift them casually —
// if one of these has to change, the contract changed and Kaamil needs telling.
//
// v2.0 payloads carry raw observations only. There is no passed, no score, no
// weight and no answer key on the wire — the server grades from its own manifest.

// fixed clock for every skew test, sits after both fixtures complete
const FIXED_NOW = Date.parse("2026-09-01T13:00:00.000Z");

const FIRE_ATTEMPT = {
  contractVersion: "2.0",
  attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
  workerId: "WRK-0001",
  moduleId: "fire-response",
  moduleVersion: 1,
  engineVersion: "2.0.0",
  deviceId: "dev-8f3a2b1c",
  arTier: 2,
  locale: "hi",
  startedAt: "2026-09-01T10:14:02.118Z",
  completedAt: "2026-09-01T10:17:41.556Z",
  durationMs: 219438,
  status: "completed",
  checkpoints: [
    {
      checkpointId: "fire_exit_identification",
      observedAt: "2026-09-01T10:14:39.902Z",
      observation: {
        kind: "spatial_alignment",
        anchorId: "fire_exit_sign",
        angularErrorRad: 0,
        dwellMs: 900,
        frameCount: 54,
        trackingSource: "arjs_marker"
      }
    },
    {
      checkpointId: "fire_extinguisher_aim",
      observedAt: "2026-09-01T10:16:20.410Z",
      observation: {
        kind: "aim_dwell",
        hitDistanceM: 0.2,
        dwellMs: 900,
        sweepCoverage: 0.8,
        frameCount: 54,
        trackingSource: "arjs_marker"
      }
    },
    {
      checkpointId: "fire_evacuation_sequence_marker",
      observedAt: "2026-09-01T10:17:41.556Z",
      observation: {
        kind: "selection_single",
        selected: "sound_alarm_then_evacuate"
      }
    },
    {
      // attemptId a3f1c9e2 rolls methaneLevel "low" (0.84% CH4), so fight the fire.
      // kept last so tests indexing exit/aim/evacuation as 0/1/2 stay put.
      checkpointId: "fire_explosion_decision",
      observedAt: "2026-09-01T10:14:52.310Z",
      observation: {
        kind: "selection_sequence",
        tries: [{ selected: "extinguish", atMs: 4200 }]
      }
    }
  ],
  clientClaimedPercentage: 91.67,
  clientClaimedPassed: true
};

const GAS_ATTEMPT = {
  contractVersion: "2.0",
  attemptId: "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64",
  workerId: "WRK-0004",
  moduleId: "gas-leak",
  moduleVersion: 1,
  engineVersion: "2.0.0",
  deviceId: "dev-4b19c7de",
  arTier: 2,
  locale: "sat",
  startedAt: "2026-09-01T11:02:15.004Z",
  completedAt: "2026-09-01T11:06:03.771Z",
  durationMs: 228767,
  status: "completed",
  checkpoints: [
    {
      checkpointId: "gas_hazard_zone_recognition",
      observedAt: "2026-09-01T11:03:01.220Z",
      observation: {
        kind: "spatial_alignment",
        anchorId: "gas_hazard_zone",
        angularErrorRad: 0,
        dwellMs: 900,
        frameCount: 61,
        trackingSource: "arjs_marker"
      }
    },
    {
      checkpointId: "gas_ppe_selection",
      observedAt: "2026-09-01T11:04:52.640Z",
      observation: {
        kind: "selection_multi",
        selected: ["scba_respirator", "multi_gas_detector"]
      }
    },
    {
      checkpointId: "gas_buddy_procedure",
      observedAt: "2026-09-01T11:06:03.771Z",
      observation: {
        kind: "selection_single",
        selected: "standby_outside_with_lifeline"
      }
    }
  ],
  clientClaimedPercentage: 89,
  clientClaimedPassed: true
};

// The exact shape that walked past the v1 server and earned a signed certificate
// without any training happening. It exists so the regression test can prove the
// door is shut. Do not "fix" it into a valid payload — its whole job is to fail.
const FORGED_V1_ATTEMPT = {
  contractVersion: "1.0",
  attemptId: "d41d8cd9-8f00-4204-a980-0998ecf8427e",
  workerId: "WRK-0001",
  moduleId: "fire-response",
  moduleVersion: 1,
  engineVersion: "1.0.0",
  deviceId: "dev-forged",
  arTier: 2,
  locale: "en",
  startedAt: "2026-09-01T10:14:02.118Z",
  completedAt: "2026-09-01T10:17:41.556Z",
  durationMs: 219438,
  status: "completed",
  checkpoints: [
    {
      checkpointId: "fire_exit_identification",
      type: "proximity",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T10:14:39.902Z",
      context: { method: "button_confirm" }
    },
    {
      checkpointId: "fire_extinguisher_aim",
      type: "aim",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T10:16:20.410Z",
      context: { score: 1 }
    },
    {
      checkpointId: "fire_evacuation_sequence",
      type: "select",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T10:17:41.556Z",
      context: { selected: "use_elevator" }
    }
  ],
  totalScore: 3,
  maxScore: 3,
  percentage: 100,
  passThresholdUsed: 0.7,
  passed: true
};

const SYNC_ENVELOPE = {
  batchId: "b71e0c93-4a2f-4d55-8e10-6f3c9d2a7b48",
  deviceId: "dev-8f3a2b1c",
  workerId: "WRK-0001",
  sentAt: "2026-09-01T12:40:11.902Z",
  attempts: []
};

// TEST ONLY. no angle has been measured on real hardware yet, so the seed leaves
// max_angular_error_rad null on purpose. this number exists to exercise the grader
// and must never be copied into db/seed.js.
const TEST_ONLY_ANGULAR_ERROR_RAD = 0.35;

// checkpoint_definition rows exactly as sqlite hands them back — snake_case, 0/1
// ints, json columns as text. these mirror db/seed.js, spatial rows included, so
// they carry gradeable 0 and a null angle just like the real manifest does.
const MANIFEST_ROWS = [
  {
    module_id: "fire-response",
    checkpoint_id: "fire_exit_identification",
    checkpoint_type: "proximity",
    observation_kind: "spatial_alignment",
    applies_to_tier: null,
    expected_value: null,
    allowed_values: null,
    forbidden_values: null,
    allowed_tracking_sources: JSON.stringify(["webxr_pose", "arjs_marker"]),
    anchor_id: "fire_exit_sign",
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 0,
    weight: 1,
    // optional until its angle is measured on a real phone, mirrors seed.js
    required: 0,
    critical: 0
  },
  {
    module_id: "fire-response",
    checkpoint_id: "fire_explosion_decision",
    checkpoint_type: "select",
    observation_kind: "selection_sequence",
    applies_to_tier: null,
    expected_value: null,
    allowed_values: JSON.stringify(["evacuate", "extinguish", "wait"]),
    forbidden_values: null,
    allowed_tracking_sources: null,
    answer_key: JSON.stringify({
      by: "methaneLevel",
      cases: {
        high: { expected: "evacuate", severity: { extinguish: "fatal", wait: "fatal" } },
        low: { expected: "extinguish", severity: { evacuate: "procedural", wait: "procedural" } }
      }
    }),
    applies_when: null,
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 1
  },
  {
    module_id: "fire-response",
    checkpoint_id: "fire_extinguisher_aim",
    checkpoint_type: "aim",
    observation_kind: "aim_dwell",
    applies_to_tier: null,
    expected_value: null,
    allowed_values: null,
    forbidden_values: null,
    allowed_tracking_sources: JSON.stringify(["webxr_pose", "arjs_marker"]),
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: 0.8,
    pass_threshold: 0.6,
    min_sweep_coverage: 0.75,
    min_dwell_ms: 800,
    min_frame_count: null,
    // only asked when the scenario leaves the fire fightable
    applies_when: JSON.stringify({ methaneLevel: "low" }),
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 0
  },
  {
    module_id: "fire-response",
    checkpoint_id: "fire_evacuation_sequence_marker",
    checkpoint_type: "select",
    observation_kind: "selection_single",
    applies_to_tier: 2,
    expected_value: JSON.stringify("sound_alarm_then_evacuate"),
    allowed_values: JSON.stringify([
      "gather_belongings",
      "sound_alarm_then_evacuate",
      "use_elevator",
      "wait_for_instructions"
    ]),
    forbidden_values: null,
    allowed_tracking_sources: null,
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 0
  },
  {
    module_id: "fire-response",
    checkpoint_id: "fire_evacuation_sequence_webxr",
    checkpoint_type: "select",
    observation_kind: "selection_single",
    applies_to_tier: 1,
    expected_value: JSON.stringify("wind_based_upwind"),
    allowed_values: JSON.stringify([
      "wind_based_upwind",
      "nearest_door",
      "elevator",
      "shelter_in_place"
    ]),
    forbidden_values: null,
    allowed_tracking_sources: null,
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 0
  },
  {
    module_id: "gas-leak",
    checkpoint_id: "gas_hazard_zone_recognition",
    checkpoint_type: "proximity",
    observation_kind: "spatial_alignment",
    applies_to_tier: null,
    expected_value: null,
    allowed_values: null,
    forbidden_values: null,
    allowed_tracking_sources: JSON.stringify(["webxr_pose", "arjs_marker"]),
    anchor_id: "gas_hazard_zone",
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 0,
    weight: 1,
    required: 1,
    critical: 0
  },
  {
    module_id: "gas-leak",
    checkpoint_id: "gas_ppe_selection",
    checkpoint_type: "select",
    observation_kind: "selection_multi",
    applies_to_tier: null,
    expected_value: JSON.stringify(["scba_respirator", "multi_gas_detector", "safety_harness"]),
    allowed_values: JSON.stringify([
      "scba_respirator",
      "multi_gas_detector",
      "safety_harness",
      "dust_mask",
      "welding_shield"
    ]),
    forbidden_values: JSON.stringify(["dust_mask", "welding_shield"]),
    allowed_tracking_sources: null,
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 0
  },
  {
    module_id: "gas-leak",
    checkpoint_id: "gas_buddy_procedure",
    checkpoint_type: "select",
    observation_kind: "selection_single",
    applies_to_tier: null,
    expected_value: JSON.stringify("standby_outside_with_lifeline"),
    allowed_values: JSON.stringify([
      "standby_outside_with_lifeline",
      "both_enter_together",
      "buddy_leaves_for_tools",
      "enter_without_communication"
    ]),
    forbidden_values: null,
    allowed_tracking_sources: null,
    anchor_id: null,
    max_angular_error_rad: null,
    max_distance_m: null,
    pass_threshold: null,
    min_sweep_coverage: null,
    min_dwell_ms: null,
    min_frame_count: null,
    gradeable: 1,
    weight: 1,
    required: 1,
    critical: 0
  }
];

// deep copy so one test mutating a fixture can never leak into the next
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// fresh fire payload, optionally with fields swapped or removed
function fireAttempt(overrides) {
  return Object.assign(clone(FIRE_ATTEMPT), overrides || {});
}

// fresh gas payload, optionally with fields swapped or removed
function gasAttempt(overrides) {
  return Object.assign(clone(GAS_ATTEMPT), overrides || {});
}

// the payload that beat the old server, ready to be thrown at the new one
function forgedV1Attempt(overrides) {
  return Object.assign(clone(FORGED_V1_ATTEMPT), overrides || {});
}

// fresh envelope wrapping whatever attempts the test wants
function syncEnvelope(attempts, overrides) {
  return Object.assign(clone(SYNC_ENVELOPE), { attempts: attempts || [clone(FIRE_ATTEMPT)] }, overrides || {});
}

// manifest rows for one module, or all of them when moduleId is left out
function manifestRows(moduleId) {
  const rows = clone(MANIFEST_ROWS);
  return moduleId ? rows.filter((row) => row.module_id === moduleId) : rows;
}

// same manifest with the two spatial checkpoints pretending someone measured them.
// only for exercising the graded path — the shipped seed keeps them unconfigured.
function measuredManifestRows(moduleId) {
  return manifestRows(moduleId).map((row) => {
    if (row.observation_kind !== "spatial_alignment") {
      return row;
    }
    return { ...row, max_angular_error_rad: TEST_ONLY_ANGULAR_ERROR_RAD, gradeable: 1 };
  });
}

module.exports = {
  FIXED_NOW,
  FIRE_ATTEMPT,
  GAS_ATTEMPT,
  FORGED_V1_ATTEMPT,
  MANIFEST_ROWS,
  TEST_ONLY_ANGULAR_ERROR_RAD,
  clone,
  fireAttempt,
  gasAttempt,
  forgedV1Attempt,
  syncEnvelope,
  manifestRows,
  measuredManifestRows
};
