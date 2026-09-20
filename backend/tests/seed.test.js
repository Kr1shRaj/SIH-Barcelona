// keep pino quiet and off the pretty transport for the whole file
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDatabase, closeDatabase } = require("../db/index");
const {
  seedDatabase,
  SEED_TIMESTAMP,
  RECERT_MONTHS_PENDING,
  CRITICAL_PENDING,
  MODULES,
  WORKERS,
  CHECKPOINT_DEFINITIONS
} = require("../db/seed");

let tmpDir = null;
let db = null;

// pull every seeded table into one comparable snapshot
function snapshot(handle) {
  return {
    mines: handle.prepare("SELECT * FROM mine ORDER BY mine_id").all(),
    contractors: handle.prepare("SELECT * FROM contractor ORDER BY contractor_id").all(),
    modules: handle.prepare("SELECT * FROM module ORDER BY module_id").all(),
    workers: handle.prepare("SELECT * FROM worker ORDER BY worker_id").all(),
    checkpointDefs: handle
      .prepare("SELECT * FROM checkpoint_definition ORDER BY module_id, checkpoint_id")
      .all()
  };
}

describe("Deterministic seed data", () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-seed-"));
    db = initDatabase(path.join(tmpDir, "seed-test.db"));
  });

  after(() => {
    closeDatabase();
    // windows releases the wal/shm sidecar locks a beat late, so retry the wipe
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("writes the expected row counts", () => {
    const counts = seedDatabase(db);

    assert.strictEqual(counts.mines, 2);
    assert.strictEqual(counts.contractors, 2);
    assert.strictEqual(counts.modules, MODULES.length);
    assert.strictEqual(counts.workers, WORKERS.length);
    assert.strictEqual(counts.checkpointDefinitions, CHECKPOINT_DEFINITIONS.length);
  });

  it("produces byte identical data when run twice", () => {
    seedDatabase(db);
    const first = snapshot(db);

    seedDatabase(db);
    const second = snapshot(db);

    assert.deepStrictEqual(second, first, "second seed run must not change any row");
  });

  it("does not duplicate rows on a repeat run", () => {
    seedDatabase(db);
    seedDatabase(db);

    const workerCount = db.prepare("SELECT COUNT(*) AS n FROM worker").get().n;
    assert.strictEqual(workerCount, WORKERS.length);
  });

  it("seeds one checkpoint definition per checkpoint the AR modules emit", () => {
    seedDatabase(db);
    const rows = db
      .prepare("SELECT module_id, checkpoint_id, checkpoint_type FROM checkpoint_definition ORDER BY module_id, checkpoint_id")
      .all();

    assert.deepStrictEqual(rows, [
      { module_id: "fire-response", checkpoint_id: "fire_alarm_pull", checkpoint_type: "select" },
      { module_id: "fire-response", checkpoint_id: "fire_evacuation_sequence_marker", checkpoint_type: "select" },
      { module_id: "fire-response", checkpoint_id: "fire_evacuation_sequence_webxr", checkpoint_type: "select" },
      { module_id: "fire-response", checkpoint_id: "fire_exit_identification", checkpoint_type: "proximity" },
      { module_id: "fire-response", checkpoint_id: "fire_extinguisher_aim", checkpoint_type: "aim" },
      { module_id: "gas-leak", checkpoint_id: "gas_buddy_procedure", checkpoint_type: "select" },
      { module_id: "gas-leak", checkpoint_id: "gas_hazard_zone_recognition", checkpoint_type: "proximity" },
      { module_id: "gas-leak", checkpoint_id: "gas_ppe_selection", checkpoint_type: "select" }
    ]);
  });

  it("pins each evacuation variant to the tier that asks its question", () => {
    seedDatabase(db);
    const rows = db
      .prepare("SELECT checkpoint_id, applies_to_tier FROM checkpoint_definition WHERE checkpoint_id LIKE 'fire_evacuation%' ORDER BY checkpoint_id")
      .all();

    assert.deepStrictEqual(rows, [
      { checkpoint_id: "fire_evacuation_sequence_marker", applies_to_tier: 2 },
      { checkpoint_id: "fire_evacuation_sequence_webxr", applies_to_tier: 1 }
    ]);
  });

  it("leaves the two spatial checkpoints unmeasured and ungradeable", () => {
    seedDatabase(db);
    const rows = db
      .prepare("SELECT checkpoint_id, max_angular_error_rad, min_frame_count, gradeable FROM checkpoint_definition WHERE observation_kind = 'spatial_alignment' ORDER BY checkpoint_id")
      .all();

    assert.deepStrictEqual(rows, [
      { checkpoint_id: "fire_exit_identification", max_angular_error_rad: null, min_frame_count: null, gradeable: 0 },
      { checkpoint_id: "gas_hazard_zone_recognition", max_angular_error_rad: null, min_frame_count: null, gradeable: 0 }
    ], "no angle has been measured on real hardware, so these must not be gradeable yet");
  });

  it("carries the aim thresholds lifted from the fire module constants", () => {
    seedDatabase(db);
    const row = db
      .prepare("SELECT max_distance_m, pass_threshold, min_sweep_coverage, min_dwell_ms, gradeable FROM checkpoint_definition WHERE checkpoint_id = 'fire_extinguisher_aim'")
      .get();

    assert.deepStrictEqual(row, {
      max_distance_m: 0.8,
      pass_threshold: 0.6,
      min_sweep_coverage: 0.75,
      min_dwell_ms: 800,
      gradeable: 1
    });
  });

  it("never lets device_orientation certify a spatial checkpoint", () => {
    seedDatabase(db);
    db.prepare("SELECT checkpoint_id, allowed_tracking_sources FROM checkpoint_definition WHERE allowed_tracking_sources IS NOT NULL")
      .all()
      .forEach((row) => {
        const sources = JSON.parse(row.allowed_tracking_sources);
        assert.deepStrictEqual(sources, ["webxr_pose", "arjs_marker"], `${row.checkpoint_id} must certify from tracked poses only`);
      });
  });

  it("keeps the answer keys on the server, one per graded selection checkpoint", () => {
    seedDatabase(db);
    const rows = db
      .prepare("SELECT checkpoint_id, expected_value FROM checkpoint_definition WHERE observation_kind LIKE 'selection%' ORDER BY checkpoint_id")
      .all()
      .map((row) => ({ checkpoint_id: row.checkpoint_id, expected: JSON.parse(row.expected_value) }));

    assert.deepStrictEqual(rows, [
      { checkpoint_id: "fire_alarm_pull", expected: "alarm_pull" },
      { checkpoint_id: "fire_evacuation_sequence_marker", expected: "sound_alarm_then_evacuate" },
      { checkpoint_id: "fire_evacuation_sequence_webxr", expected: "wind_based_upwind" },
      { checkpoint_id: "gas_buddy_procedure", expected: "standby_outside_with_lifeline" },
      { checkpoint_id: "gas_ppe_selection", expected: ["scba_respirator", "multi_gas_detector", "safety_harness"] }
    ]);
  });

  it("marks required checkpoints and keeps alarm pull optional with equal weight", () => {
    seedDatabase(db);
    db.prepare("SELECT * FROM checkpoint_definition").all().forEach((row) => {
      const expectedRequired = row.checkpoint_id === "fire_alarm_pull" ? 0 : 1;
      assert.strictEqual(row.required, expectedRequired, `${row.checkpoint_id} required flag is wrong`);
      assert.strictEqual(row.weight, 1, `${row.checkpoint_id} must weigh 1 until content says otherwise`);
    });
  });

  it("leaves critical at 0, the safety ruling has not been made yet", () => {
    seedDatabase(db);
    assert.strictEqual(CRITICAL_PENDING, 0);

    db.prepare("SELECT checkpoint_id, critical FROM checkpoint_definition").all().forEach((row) => {
      assert.strictEqual(row.critical, 0, `${row.checkpoint_id} must not claim a safety ruling`);
    });
  });

  it("points every checkpoint definition at a module that exists", () => {
    seedDatabase(db);
    const orphans = db
      .prepare(
        `SELECT d.checkpoint_id FROM checkpoint_definition d
         LEFT JOIN module m ON m.module_id = d.module_id
         WHERE m.module_id IS NULL`
      )
      .all();

    assert.deepStrictEqual(orphans, []);
  });

  it("stamps every row with the fixed seed timestamp, never a clock read", () => {
    seedDatabase(db);
    const snap = snapshot(db);

    ["mines", "contractors", "modules", "workers", "checkpointDefs"].forEach((table) => {
      snap[table].forEach((row) => {
        assert.strictEqual(row.created_at, SEED_TIMESTAMP, `${table} row must use the fixed stamp`);
      });
    });
  });

  it("leaves recert_months NULL, the Mines Act period is not decided yet", () => {
    seedDatabase(db);
    const modules = db.prepare("SELECT module_id, recert_months FROM module").all();

    assert.strictEqual(RECERT_MONTHS_PENDING, null);
    modules.forEach((row) => {
      assert.strictEqual(row.recert_months, null, `${row.module_id} must not invent a recert period`);
    });
  });

  it("seeds module ids that match the frontend module folder names", () => {
    seedDatabase(db);
    const ids = db.prepare("SELECT module_id FROM module ORDER BY module_id").all().map((r) => r.module_id);

    assert.deepStrictEqual(ids, ["fire-response", "gas-leak"]);
  });

  it("gives every module a pass threshold between 0 and 1", () => {
    seedDatabase(db);
    const modules = db.prepare("SELECT module_id, pass_threshold FROM module").all();

    modules.forEach((row) => {
      assert.ok(
        row.pass_threshold > 0 && row.pass_threshold <= 1,
        `${row.module_id} threshold out of range: ${row.pass_threshold}`
      );
    });
  });

  it("wires every seeded worker to a mine and contractor that exist", () => {
    seedDatabase(db);
    const orphans = db
      .prepare(
        `SELECT w.worker_id FROM worker w
         LEFT JOIN mine m ON m.mine_id = w.mine_id
         LEFT JOIN contractor c ON c.contractor_id = w.contractor_id
         WHERE m.mine_id IS NULL OR c.contractor_id IS NULL`
      )
      .all();

    assert.deepStrictEqual(orphans, [], "no seeded worker may point at a missing mine or contractor");
  });

  it("seeds no certificates, signing is not built yet", () => {
    seedDatabase(db);
    const certCount = db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n;

    assert.strictEqual(certCount, 0, "seed must never fabricate a signed certificate");
  });
});
