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
  { moduleId: "fire-response", title: "Fire & Explosion Response" },
  { moduleId: "gas-leak", title: "Gas Leak & Confined Space Protocol" }
];

// every checkpoint weighs the same for now, real weighting is a content call
const DEFAULT_CHECKPOINT_WEIGHT = 1;

// 0 = module passes on aggregate score alone. NOT a safety ruling — the team has not
// decided which checkpoints must fail the whole module on their own. 0 keeps today's behaviour.
const CRITICAL_PENDING = 0;

// checkpoint ids read straight out of the AR modules. these are facts, not choices —
// they must stay in step with fire-response.js and gas-leak.js.
const CHECKPOINT_DEFINITIONS = [
  { moduleId: "fire-response", checkpointId: "fire_exit_identification", type: "proximity" },
  { moduleId: "fire-response", checkpointId: "fire_extinguisher_aim", type: "aim" },
  { moduleId: "fire-response", checkpointId: "fire_evacuation_sequence", type: "select" },
  { moduleId: "gas-leak", checkpointId: "gas_hazard_zone_recognition", type: "proximity" },
  { moduleId: "gas-leak", checkpointId: "gas_ppe_selection", type: "select" },
  { moduleId: "gas-leak", checkpointId: "gas_buddy_procedure", type: "select" }
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
       (module_id, checkpoint_id, checkpoint_type, weight, required, critical, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(module_id, checkpoint_id) DO UPDATE SET
       checkpoint_type = excluded.checkpoint_type, weight = excluded.weight,
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
        PLACEHOLDER_PASS_THRESHOLD,
        1,
        RECERT_MONTHS_PENDING,
        SEED_TIMESTAMP
      )
    );
    WORKERS.forEach((w) =>
      insertWorker.run(w.workerId, w.name, w.mineId, w.contractorId, SEED_TIMESTAMP)
    );
    CHECKPOINT_DEFINITIONS.forEach((c) =>
      insertCheckpointDef.run(
        c.moduleId,
        c.checkpointId,
        c.type,
        DEFAULT_CHECKPOINT_WEIGHT,
        1,
        CRITICAL_PENDING,
        SEED_TIMESTAMP
      )
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
  MINES,
  CONTRACTORS,
  MODULES,
  WORKERS,
  CHECKPOINT_DEFINITIONS
};
