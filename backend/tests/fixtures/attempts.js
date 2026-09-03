// Golden payloads copied from the SafeAR Attempt Contract v1.0.
// Both sides of the integration point at these. Do not drift them casually —
// if one of these has to change, the contract changed and Kaamil needs telling.

// fixed clock for every skew test, sits after both fixtures complete
const FIXED_NOW = Date.parse("2026-09-01T13:00:00.000Z");

const FIRE_ATTEMPT = {
  contractVersion: "1.0",
  attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
  workerId: "WRK-0001",
  moduleId: "fire-response",
  moduleVersion: 1,
  engineVersion: "1.0.0",
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
      score: 0.75,
      weight: 1,
      timestamp: "2026-09-01T10:16:20.410Z",
      context: { accuracy: 0.75, target: "base", distance: 0.2 }
    },
    {
      checkpointId: "fire_evacuation_sequence",
      type: "select",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T10:17:41.556Z",
      context: { selected: "sound_alarm_then_evacuate" }
    }
  ],
  totalScore: 2.75,
  maxScore: 3,
  percentage: 91.67,
  passThresholdUsed: 0.7,
  passed: true
};

const GAS_ATTEMPT = {
  contractVersion: "1.0",
  attemptId: "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64",
  workerId: "WRK-0004",
  moduleId: "gas-leak",
  moduleVersion: 1,
  engineVersion: "1.0.0",
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
      type: "proximity",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T11:03:01.220Z",
      context: { method: "button_confirm" }
    },
    {
      checkpointId: "gas_ppe_selection",
      type: "select",
      passed: false,
      score: 0.67,
      weight: 1,
      timestamp: "2026-09-01T11:04:52.640Z",
      context: {
        selected: ["scba_respirator", "multi_gas_detector"],
        score: 0.67,
        missing: ["safety_harness"],
        forbidden: []
      }
    },
    {
      checkpointId: "gas_buddy_procedure",
      type: "select",
      passed: true,
      score: 1,
      weight: 1,
      timestamp: "2026-09-01T11:06:03.771Z",
      context: { selected: "standby_outside_with_lifeline" }
    }
  ],
  totalScore: 2.67,
  maxScore: 3,
  percentage: 89,
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

// checkpoint_definition rows exactly as sqlite hands them back, snake_case and 0/1 ints
const MANIFEST_ROWS = [
  { module_id: "fire-response", checkpoint_id: "fire_exit_identification", checkpoint_type: "proximity", weight: 1, required: 1, critical: 0 },
  { module_id: "fire-response", checkpoint_id: "fire_extinguisher_aim", checkpoint_type: "aim", weight: 1, required: 1, critical: 0 },
  { module_id: "fire-response", checkpoint_id: "fire_evacuation_sequence", checkpoint_type: "select", weight: 1, required: 1, critical: 0 },
  { module_id: "gas-leak", checkpoint_id: "gas_hazard_zone_recognition", checkpoint_type: "proximity", weight: 1, required: 1, critical: 0 },
  { module_id: "gas-leak", checkpoint_id: "gas_ppe_selection", checkpoint_type: "select", weight: 1, required: 1, critical: 0 },
  { module_id: "gas-leak", checkpoint_id: "gas_buddy_procedure", checkpoint_type: "select", weight: 1, required: 1, critical: 0 }
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

// fresh envelope wrapping whatever attempts the test wants
function syncEnvelope(attempts, overrides) {
  return Object.assign(clone(SYNC_ENVELOPE), { attempts: attempts || [clone(FIRE_ATTEMPT)] }, overrides || {});
}

// manifest rows for one module, or all of them when moduleId is left out
function manifestRows(moduleId) {
  const rows = clone(MANIFEST_ROWS);
  return moduleId ? rows.filter((row) => row.module_id === moduleId) : rows;
}

module.exports = {
  FIXED_NOW,
  FIRE_ATTEMPT,
  GAS_ATTEMPT,
  MANIFEST_ROWS,
  clone,
  fireAttempt,
  gasAttempt,
  syncEnvelope,
  manifestRows
};
