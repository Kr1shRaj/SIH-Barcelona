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
  MODULES,
  WORKERS
} = require("../db/seed");

let tmpDir = null;
let db = null;

// pull every seeded table into one comparable snapshot
function snapshot(handle) {
  return {
    mines: handle.prepare("SELECT * FROM mine ORDER BY mine_id").all(),
    contractors: handle.prepare("SELECT * FROM contractor ORDER BY contractor_id").all(),
    modules: handle.prepare("SELECT * FROM module ORDER BY module_id").all(),
    workers: handle.prepare("SELECT * FROM worker ORDER BY worker_id").all()
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

  it("stamps every row with the fixed seed timestamp, never a clock read", () => {
    seedDatabase(db);
    const snap = snapshot(db);

    ["mines", "contractors", "modules", "workers"].forEach((table) => {
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
