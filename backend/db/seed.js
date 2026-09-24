const { initDatabase, closeDatabase } = require("./index");
const { getConfig } = require("../config");
const { createChildLogger, logConfigWarnings } = require("../logger");

// every seed row carries this stamp so two runs make byte identical data
const SEED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

// PLACEHOLDER pass mark. Real per-module threshold is still an open team decision.
// Do not read this number as agreed content — it exists so the column is not empty.
const PLACEHOLDER_PASS_THRESHOLD = 0.7;

// recert period stays NULL until the Mines Act figure is confirmed by the team
const RECERT_MONTHS_PENDING = null;

const MINES = [
  { mineId: "MINE-JH-001", name: "Jharia Coal Block A", district: "Dhanbad" },
  { mineId: "MINE-JH-002", name: "Noamundi Iron Ore Pit", district: "West Singhbhum" }
];

const CONTRACTORS = [
  { contractorId: "CON-001", name: "Jharkhand Mining Contractors Pvt Ltd" },
  { contractorId: "CON-002", name: "Santhal Labour Cooperative" }
];

// module ids match the frontend module folder names, do not rename one without the other
const MODULES = [
  { moduleId: "fire-response", title: "Fire & Explosion Response", passThreshold: PLACEHOLDER_PASS_THRESHOLD },
  { moduleId: "gas-leak", title: "Gas Leak & Confined Space Protocol", passThreshold: PLACEHOLDER_PASS_THRESHOLD },
  { moduleId: "fire-response-team", title: "Fire Response Team Drill", passThreshold: 0.8 }
];

// every checkpoint weighs the same for now, real weighting is a content call
const DEFAULT_CHECKPOINT_WEIGHT = 1;

// 0 = module passes on aggregate score alone. NOT a safety ruling — the team has not
// decided which checkpoints must fail the whole module on their own. 0 keeps today's behaviour.
const CRITICAL_PENDING = 0;

// NOT MEASURED YET. the angle a trainee must hold to count as looking at an anchor
// has never been read off a real device, so it stays null and the grader scores the
// checkpoint zero. do not fill this in from a guess — it decides who gets certified.
const ANGULAR_ERROR_UNMEASURED = null;

// same story. no frame count floor has been observed on target hardware.
const FRAME_COUNT_UNMEASURED = null;

// only these two tracking sources may ever certify. device_orientation is gyro only,
// drifts, and carries no translation, so it is deliberately absent.
const CERTIFYING_TRACKING_SOURCES = JSON.stringify(["webxr_pose", "arjs_marker"]);

// lifted from webxr_fire_module.js evaluateGazeAimProgress(..., 800)
const AIM_DWELL_MS = 800;

// lifted from fire-response.js FIRE_BASE_MAX_DISTANCE_3D
const AIM_MAX_DISTANCE_M = 0.8;

// lifted from fire-response.js AIM_PASS_THRESHOLD
const AIM_PASS_THRESHOLD = 0.6;

// lifted from fire-response.js SWEEP_MIN_COVERAGE
const AIM_MIN_SWEEP_COVERAGE = 0.75;

// fire gates only. the decision gate is life critical: a fatal pick fails the run
// even when the worker corrects it. team ruling, see audit gate 1.
const CRITICAL_GATE = 1;

// methane decision key, one case per scenario methaneLevel. at or above 1.25% CH4
// (METHANE_WITHDRAWAL_PCT) the worker withdraws. fighting the fire or staying put
// there is fatal. below it, walking off or waiting is a procedural slip.
// frontend/modules/fire-response/scenario.js carries the same key for offline
// feedback, golden_fire_contract.test.js keeps the two in step.
const FIRE_DECISION_ANSWER_KEY = {
  by: "methaneLevel",
  cases: {
    high: { expected: "evacuate", severity: { extinguish: "fatal", wait: "fatal" } },
    low: { expected: "extinguish", severity: { evacuate: "procedural", wait: "procedural" } }
  }
};

// checkpoints that only happen when the worker stays to fight the fire
const SUPPRESS_BRANCH_ONLY = JSON.stringify({ methaneLevel: "low" });

// checkpoint ids and option lists read straight out of the AR modules. these are
// facts, not choices — they must stay in step with fire-response.js, gas-leak.js
// and webxr_fire_module.js. the answer keys live here and nowhere on a phone.
//
// gradeable 0 means the rule is not configured yet: the grader scores it zero and
// the certificate service refuses the whole attempt. that is the honest state until
// the two spatial checkpoints are genuinely measurable on a device.
const CHECKPOINT_DEFINITIONS = [
  {
    moduleId: "fire-response",
    checkpointId: "fire_exit_identification",
    type: "proximity",
    observationKind: "spatial_alignment",
    anchorId: "fire_exit_sign",
    maxAngularErrorRad: ANGULAR_ERROR_UNMEASURED,
    minFrameCount: FRAME_COUNT_UNMEASURED,
    allowedTrackingSources: CERTIFYING_TRACKING_SOURCES,
    gradeable: 0,
    // team ruling: exit sighting is recorded, not scored, until the angle is
    // measured on a real phone. optional + ungradeable never blocks a cert.
    required: 0
  },
  {
    moduleId: "fire-response",
    checkpointId: "fire_explosion_decision",
    type: "select",
    observationKind: "selection_sequence",
    allowedValues: JSON.stringify(["evacuate", "extinguish", "wait"]),
    answerKey: JSON.stringify(FIRE_DECISION_ANSWER_KEY),
    gradeable: 1,
    critical: CRITICAL_GATE
  },
  {
    moduleId: "fire-response",
    checkpointId: "fire_extinguisher_aim",
    type: "aim",
    observationKind: "aim_dwell",
    maxDistanceM: AIM_MAX_DISTANCE_M,
    passThreshold: AIM_PASS_THRESHOLD,
    minSweepCoverage: AIM_MIN_SWEEP_COVERAGE,
    minDwellMs: AIM_DWELL_MS,
    minFrameCount: FRAME_COUNT_UNMEASURED,
    allowedTrackingSources: CERTIFYING_TRACKING_SOURCES,
    appliesWhen: SUPPRESS_BRANCH_ONLY,
    gradeable: 1
  },
  {
    moduleId: "fire-response",
    checkpointId: "fire_alarm_pull",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("alarm_pull"),
    allowedValues: JSON.stringify(["alarm_pull"]),
    appliesWhen: SUPPRESS_BRANCH_ONLY,
    gradeable: 1,
    required: 0
  },
  {
    moduleId: "fire-response",
    checkpointId: "fire_evacuation_sequence_marker",
    type: "select",
    observationKind: "selection_single",
    appliesToTier: 2,
    expectedValue: JSON.stringify("sound_alarm_then_evacuate"),
    allowedValues: JSON.stringify([
      "gather_belongings",
      "sound_alarm_then_evacuate",
      "use_elevator",
      "wait_for_instructions"
    ]),
    gradeable: 1
  },
  {
    moduleId: "fire-response",
    checkpointId: "fire_evacuation_sequence_webxr",
    type: "select",
    observationKind: "selection_single",
    appliesToTier: 1,
    expectedValue: JSON.stringify("wind_based_upwind"),
    allowedValues: JSON.stringify([
      "wind_based_upwind",
      "nearest_door",
      "elevator",
      "shelter_in_place"
    ]),
    gradeable: 1
  },
  {
    moduleId: "gas-leak",
    checkpointId: "gas_hazard_zone_recognition",
    type: "proximity",
    observationKind: "spatial_alignment",
    anchorId: "gas_hazard_zone",
    maxAngularErrorRad: ANGULAR_ERROR_UNMEASURED,
    minFrameCount: FRAME_COUNT_UNMEASURED,
    allowedTrackingSources: CERTIFYING_TRACKING_SOURCES,
    gradeable: 0
  },
  {
    moduleId: "gas-leak",
    checkpointId: "gas_ppe_selection",
    type: "select",
    observationKind: "selection_multi",
    expectedValue: JSON.stringify(["scba_respirator", "multi_gas_detector", "safety_harness"]),
    allowedValues: JSON.stringify([
      "scba_respirator",
      "multi_gas_detector",
      "safety_harness",
      "dust_mask",
      "welding_shield"
    ]),
    forbiddenValues: JSON.stringify(["dust_mask", "welding_shield"]),
    gradeable: 1
  },
  {
    moduleId: "gas-leak",
    checkpointId: "gas_buddy_procedure",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("standby_outside_with_lifeline"),
    allowedValues: JSON.stringify([
      "standby_outside_with_lifeline",
      "both_enter_together",
      "buddy_leaves_for_tools",
      "enter_without_communication"
    ]),
    gradeable: 1
  },
  // team drill checkpoints scored from server timeline
  {
    moduleId: "fire-response-team",
    checkpointId: "team_alarm_pull",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("alarm_pulled"),
    allowedValues: JSON.stringify(["alarm_pulled", "skipped"]),
    gradeable: 1,
    required: 1
  },
  {
    moduleId: "fire-response-team",
    checkpointId: "team_extinguisher_select",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("correct_selection"),
    allowedValues: JSON.stringify(["correct_selection", "wrong_selection", "skipped"]),
    gradeable: 1,
    required: 1
    // no critical flag — defaults to CRITICAL_PENDING (0) per existing convention
  },
  {
    moduleId: "fire-response-team",
    checkpointId: "team_fire_extinguish",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("fire_extinguished"),
    allowedValues: JSON.stringify(["fire_extinguished", "skipped"]),
    gradeable: 1,
    required: 1
  },
  {
    moduleId: "fire-response-team",
    checkpointId: "team_evac_coordinate",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("evac_checked"),
    allowedValues: JSON.stringify(["evac_checked", "skipped"]),
    gradeable: 1,
    required: 1
  },
  {
    moduleId: "fire-response-team",
    checkpointId: "team_drill_outcome",
    type: "select",
    observationKind: "selection_single",
    expectedValue: JSON.stringify("drill_passed"),
    allowedValues: JSON.stringify(["drill_passed", "drill_failed"]),
    gradeable: 1,
    required: 1,
    // failed drill fails every participant attempt, the result screen already
    // shows FAILED to the whole team
    critical: 1
  }
];

const WORKERS = [
  { workerId: "WRK-0001", name: "Budhan Murmu", mineId: "MINE-JH-001", contractorId: "CON-001" },
  { workerId: "WRK-0002", name: "Sita Devi", mineId: "MINE-JH-001", contractorId: "CON-001" },
  { workerId: "WRK-0003", name: "Ramesh Oraon", mineId: "MINE-JH-001", contractorId: "CON-002" },
  { workerId: "WRK-0004", name: "Mangal Hansda", mineId: "MINE-JH-002", contractorId: "CON-002" },
  { workerId: "WRK-0005", name: "Phulmani Tudu", mineId: "MINE-JH-002", contractorId: "CON-002" },
  { workerId: "WRK-0006", name: "Anil Mahto", mineId: "MINE-JH-002", contractorId: "CON-001" }
];

// write demo rows, same input every run, safe to call twice
function seedDatabase(db) {
  const insertMine = db.prepare(
    `INSERT INTO mine (mine_id, name, district, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(mine_id) DO UPDATE SET
       name = excluded.name, district = excluded.district, created_at = excluded.created_at`
  );

  const insertContractor = db.prepare(
    `INSERT INTO contractor (contractor_id, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(contractor_id) DO UPDATE SET
       name = excluded.name, created_at = excluded.created_at`
  );

  const insertModule = db.prepare(
    `INSERT INTO module (module_id, title, pass_threshold, version, recert_months, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(module_id) DO UPDATE SET
       title = excluded.title, pass_threshold = excluded.pass_threshold,
       version = excluded.version, recert_months = excluded.recert_months,
       created_at = excluded.created_at`
  );

  const insertWorker = db.prepare(
    `INSERT INTO worker (worker_id, name, mine_id, contractor_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(worker_id) DO UPDATE SET
       name = excluded.name, mine_id = excluded.mine_id,
       contractor_id = excluded.contractor_id, created_at = excluded.created_at`
  );

  const insertCheckpointDef = db.prepare(
    `INSERT INTO checkpoint_definition
       (module_id, checkpoint_id, checkpoint_type, observation_kind, applies_to_tier,
        expected_value, allowed_values, forbidden_values, allowed_tracking_sources,
        answer_key, applies_when,
        anchor_id, max_angular_error_rad,
        max_distance_m, pass_threshold, min_sweep_coverage,
        min_dwell_ms, min_frame_count,
        gradeable, weight, required, critical, created_at)
     VALUES (
        @module_id, @checkpoint_id, @checkpoint_type, @observation_kind, @applies_to_tier,
        @expected_value, @allowed_values, @forbidden_values, @allowed_tracking_sources,
        @answer_key, @applies_when,
        @anchor_id, @max_angular_error_rad,
        @max_distance_m, @pass_threshold, @min_sweep_coverage,
        @min_dwell_ms, @min_frame_count,
        @gradeable, @weight, @required, @critical, @created_at)
     ON CONFLICT(module_id, checkpoint_id) DO UPDATE SET
       checkpoint_type = excluded.checkpoint_type,
       observation_kind = excluded.observation_kind,
       applies_to_tier = excluded.applies_to_tier,
       expected_value = excluded.expected_value,
       allowed_values = excluded.allowed_values,
       forbidden_values = excluded.forbidden_values,
       allowed_tracking_sources = excluded.allowed_tracking_sources,
       answer_key = excluded.answer_key,
       applies_when = excluded.applies_when,
       anchor_id = excluded.anchor_id,
       max_angular_error_rad = excluded.max_angular_error_rad,
       max_distance_m = excluded.max_distance_m,
       pass_threshold = excluded.pass_threshold,
       min_sweep_coverage = excluded.min_sweep_coverage,
       min_dwell_ms = excluded.min_dwell_ms,
       min_frame_count = excluded.min_frame_count,
       gradeable = excluded.gradeable, weight = excluded.weight,
       required = excluded.required, critical = excluded.critical,
       created_at = excluded.created_at`
  );

  // one transaction so a half written seed can never be left behind
  const run = db.transaction(() => {
    MINES.forEach((m) => insertMine.run(m.mineId, m.name, m.district, SEED_TIMESTAMP));
    CONTRACTORS.forEach((c) => insertContractor.run(c.contractorId, c.name, SEED_TIMESTAMP));
    MODULES.forEach((m) =>
      insertModule.run(
        m.moduleId,
        m.title,
        m.passThreshold !== undefined ? m.passThreshold : PLACEHOLDER_PASS_THRESHOLD,
        1,
        RECERT_MONTHS_PENDING,
        SEED_TIMESTAMP
      )
    );
    WORKERS.forEach((w) =>
      insertWorker.run(w.workerId, w.name, w.mineId, w.contractorId, SEED_TIMESTAMP)
    );
    CHECKPOINT_DEFINITIONS.forEach((c) =>
      insertCheckpointDef.run({
        module_id: c.moduleId,
        checkpoint_id: c.checkpointId,
        checkpoint_type: c.type,
        observation_kind: c.observationKind,
        applies_to_tier: c.appliesToTier === undefined ? null : c.appliesToTier,
        expected_value: c.expectedValue === undefined ? null : c.expectedValue,
        allowed_values: c.allowedValues === undefined ? null : c.allowedValues,
        forbidden_values: c.forbiddenValues === undefined ? null : c.forbiddenValues,
        allowed_tracking_sources:
          c.allowedTrackingSources === undefined ? null : c.allowedTrackingSources,
        answer_key: c.answerKey === undefined ? null : c.answerKey,
        applies_when: c.appliesWhen === undefined ? null : c.appliesWhen,
        anchor_id: c.anchorId === undefined ? null : c.anchorId,
        max_angular_error_rad: c.maxAngularErrorRad === undefined ? null : c.maxAngularErrorRad,
        max_distance_m: c.maxDistanceM === undefined ? null : c.maxDistanceM,
        pass_threshold: c.passThreshold === undefined ? null : c.passThreshold,
        min_sweep_coverage: c.minSweepCoverage === undefined ? null : c.minSweepCoverage,
        min_dwell_ms: c.minDwellMs === undefined ? null : c.minDwellMs,
        min_frame_count: c.minFrameCount === undefined ? null : c.minFrameCount,
        gradeable: c.gradeable,
        weight: DEFAULT_CHECKPOINT_WEIGHT,
        required: c.required === undefined ? 1 : c.required,
        critical: c.critical === undefined ? CRITICAL_PENDING : c.critical,
        created_at: SEED_TIMESTAMP
      })
    );
  });

  run();

  return {
    mines: MINES.length,
    contractors: CONTRACTORS.length,
    modules: MODULES.length,
    workers: WORKERS.length,
    checkpointDefinitions: CHECKPOINT_DEFINITIONS.length
  };
}

// cli entry: npm run seed
if (require.main === module) {
  const log = createChildLogger({ component: "seed" });
  const config = getConfig();
  logConfigWarnings(config, log);

  const db = initDatabase(config.dbPath);
  const counts = seedDatabase(db);
  closeDatabase();

  log.info({ event: "seed_complete", ...counts }, "Seed data written");
}

module.exports = {
  seedDatabase,
  SEED_TIMESTAMP,
  PLACEHOLDER_PASS_THRESHOLD,
  RECERT_MONTHS_PENDING,
  DEFAULT_CHECKPOINT_WEIGHT,
  CRITICAL_PENDING,
  ANGULAR_ERROR_UNMEASURED,
  FRAME_COUNT_UNMEASURED,
  CERTIFYING_TRACKING_SOURCES,
  AIM_DWELL_MS,
  AIM_MAX_DISTANCE_M,
  AIM_PASS_THRESHOLD,
  AIM_MIN_SWEEP_COVERAGE,
  MINES,
  CONTRACTORS,
  MODULES,
  WORKERS,
  CHECKPOINT_DEFINITIONS,
  FIRE_DECISION_ANSWER_KEY
};
