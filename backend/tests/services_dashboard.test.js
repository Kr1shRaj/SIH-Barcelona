process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDatabase, closeDatabase } = require("../db/index");
const { getComplianceMetrics } = require("../services/dashboard");

// Which certificate the roster shows when a worker holds more than one for a module.
//
// The schema allows several — one per passed attempt — and nothing stops a worker
// redoing a module. Before this was pinned down the query had no ORDER BY and the
// map simply overwrote, so the answer was whatever row order SQLite happened to
// produce. A supervisor could be shown a superseded credential.

const T = "2026-01-01T00:00:00.000Z";
let dir = null;
let db = null;

function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-dash-"));
  db = initDatabase(path.join(dir, "dash-test.db"));
  db.prepare("INSERT INTO mine (mine_id,name,district,created_at) VALUES (?,?,?,?)").run("M1", "Mine", "D", T);
  db.prepare("INSERT INTO contractor (contractor_id,name,created_at) VALUES (?,?,?)").run("C1", "Con", T);
  db.prepare("INSERT INTO worker (worker_id,name,mine_id,contractor_id,created_at) VALUES (?,?,?,?,?)")
    .run("WRK-0001", "Budhan Murmu", "M1", "C1", T);
  db.prepare("INSERT INTO module (module_id,title,pass_threshold,created_at) VALUES (?,?,?,?)")
    .run("fire-response", "Fire", 0.7, T);
}

function teardown() {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function addCert({ certId, issuedAt, revoked = 0, expiresAt = null }) {
  db.prepare(
    `INSERT INTO certificate
       (cert_id, worker_id, module_id, score, issued_at, expires_at, algo, key_id, signature, payload_json, revoked)
     VALUES (?, 'WRK-0001', 'fire-response', 100, ?, ?, 'Ed25519', 'k', 's', '{}', ?)`
  ).run(certId, issuedAt, expiresAt, revoked);
}

function chosenCert() {
  const roster = getComplianceMetrics(db).roster.find((w) => w.workerId === "WRK-0001");
  return roster.modules["fire-response"];
}

describe("dashboard picks one certificate per worker and module", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("1. the newest issue date wins when the newest is inserted first", () => {
    addCert({ certId: "SAFEAR-NEWER0000000A", issuedAt: "2026-09-03T20:00:00.000Z" });
    addCert({ certId: "SAFEAR-OLDER0000000B", issuedAt: "2026-01-01T00:00:00.000Z" });
    assert.strictEqual(chosenCert().certId, "SAFEAR-NEWER0000000A");
  });

  it("2. the newest issue date wins when the newest is inserted last", () => {
    addCert({ certId: "SAFEAR-OLDER0000000B", issuedAt: "2026-01-01T00:00:00.000Z" });
    addCert({ certId: "SAFEAR-NEWER0000000A", issuedAt: "2026-09-03T20:00:00.000Z" });
    assert.strictEqual(chosenCert().certId, "SAFEAR-NEWER0000000A");
  });

  it("3. the answer does not depend on insertion order at all", () => {
    // the same three certificates, inserted both ways round, must agree
    const certs = [
      { certId: "SAFEAR-AAAAAAAAAAAAAAAA", issuedAt: "2026-03-01T00:00:00.000Z" },
      { certId: "SAFEAR-BBBBBBBBBBBBBBBB", issuedAt: "2026-07-01T00:00:00.000Z" },
      { certId: "SAFEAR-CCCCCCCCCCCCCCCC", issuedAt: "2026-05-01T00:00:00.000Z" }
    ];
    certs.forEach(addCert);
    const forward = chosenCert().certId;
    teardown();

    setup();
    certs.slice().reverse().forEach(addCert);
    const backward = chosenCert().certId;

    assert.strictEqual(forward, "SAFEAR-BBBBBBBBBBBBBBBB", "July is the newest");
    assert.strictEqual(backward, forward, "insertion order must not change the answer");
  });

  it("4. an equal issue date is broken deterministically by cert id", () => {
    const same = "2026-06-01T12:00:00.000Z";
    addCert({ certId: "SAFEAR-1111111111111111", issuedAt: same });
    addCert({ certId: "SAFEAR-9999999999999999", issuedAt: same });
    assert.strictEqual(chosenCert().certId, "SAFEAR-9999999999999999", "highest cert id wins a tie");
  });

  it("5. the tie-break is stable whichever order the rows arrive in", () => {
    const same = "2026-06-01T12:00:00.000Z";
    addCert({ certId: "SAFEAR-9999999999999999", issuedAt: same });
    addCert({ certId: "SAFEAR-1111111111111111", issuedAt: same });
    assert.strictEqual(chosenCert().certId, "SAFEAR-9999999999999999");
  });

  it("6. expiry travels with the certificate that was chosen", () => {
    addCert({ certId: "SAFEAR-OLDER0000000B", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" });
    addCert({ certId: "SAFEAR-NEWER0000000A", issuedAt: "2026-09-03T20:00:00.000Z", expiresAt: "2028-09-03T20:00:00.000Z" });
    const mod = chosenCert();
    assert.strictEqual(mod.certId, "SAFEAR-NEWER0000000A");
    assert.strictEqual(mod.expiresAt, "2028-09-03T20:00:00.000Z", "must not pair a new id with an old expiry");
  });

  it("7. revoked certificates stay excluded, even when newest", () => {
    addCert({ certId: "SAFEAR-GOOD000000000AA", issuedAt: "2026-01-01T00:00:00.000Z" });
    addCert({ certId: "SAFEAR-REVOKED000000BB", issuedAt: "2026-09-03T20:00:00.000Z", revoked: 1 });
    assert.strictEqual(chosenCert().certId, "SAFEAR-GOOD000000000AA", "a revoked credential must never be shown");
  });

  it("8. a worker whose only certificate is revoked shows none", () => {
    addCert({ certId: "SAFEAR-REVOKED000000BB", issuedAt: "2026-09-03T20:00:00.000Z", revoked: 1 });
    assert.strictEqual(chosenCert().certId, null);
  });

  it("9. a single certificate is still chosen", () => {
    addCert({ certId: "SAFEAR-ONLY0000000000A", issuedAt: "2026-04-01T00:00:00.000Z" });
    assert.strictEqual(chosenCert().certId, "SAFEAR-ONLY0000000000A");
  });

  it("10. no certificates means no certificate id", () => {
    assert.strictEqual(chosenCert().certId, null);
    assert.strictEqual(chosenCert().expiresAt, null);
  });
});
