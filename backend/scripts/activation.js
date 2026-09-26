#!/usr/bin/env node
//
// Issue trainee activation codes.
//
//   npm run activate --workspace=backend -- --worker WRK-0002
//   npm run activate --workspace=backend -- --all
//   npm run activate --workspace=backend -- --worker WRK-0002 --force-reset
//
// The printed code is the ONLY time the plaintext exists. The database keeps a
// sha256 of it, so nobody — including whoever holds the database file — can read
// it back. Lose it and issue a new one; there is no recovery by design.
//
// This exists instead of a worker-management UI because the roster is already
// administrator-owned: `worker` rows come from the seed or from whatever process
// enrols a mine's workforce. This only grants one of those rows the ability to
// log in.

const { getConfig } = require("../config");
const { initDatabase, closeDatabase } = require("../db/index");
const { issueActivationCode, revokeAllSessionsForAccount, ACTIVATION_TTL_DAYS } = require("../services/accounts");

function parseArgs(argv) {
  const args = { worker: null, all: false, forceReset: false, ttlDays: ACTIVATION_TTL_DAYS, iKnow: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--worker") { args.worker = argv[i + 1]; i += 1; }
    else if (arg === "--all") args.all = true;
    else if (arg === "--force-reset") args.forceReset = true;
    else if (arg === "--i-know") args.iKnow = true;
    else if (arg === "--expires-days") { args.ttlDays = Number.parseInt(argv[i + 1], 10); i += 1; }
  }
  return args;
}

function usage() {
  process.stdout.write(
    "\nIssue a SafeAR trainee activation code.\n\n" +
    "  --worker <WORKER_ID>   one worker from the roster\n" +
    "  --all                  every roster worker without an account\n" +
    "  --force-reset          revoke an existing account and its sessions, then issue a new code\n" +
    "  --expires-days <n>     code lifetime, default " + ACTIVATION_TTL_DAYS + "\n\n"
  );
}

// remove an account so a worker can be activated again. used for a forgotten PIN
// in a demo, and deliberately loud: every session that account holds dies with it.
function resetAccount(db, workerId) {
  const account = db.prepare("SELECT account_id FROM trainee_account WHERE worker_id = ?").get(workerId);
  if (!account) return false;
  const tx = db.transaction(() => {
    revokeAllSessionsForAccount(db, account.account_id);
    db.prepare("UPDATE trainee_activation SET consumed_by = NULL WHERE consumed_by = ?").run(account.account_id);
    db.prepare("DELETE FROM trainee_account WHERE account_id = ?").run(account.account_id);
  });
  tx();
  return true;
}

function issueFor(db, workerId, args) {
  if (args.forceReset && resetAccount(db, workerId)) {
    process.stdout.write(`  reset existing account for ${workerId} and revoked its sessions\n`);
  }

  try {
    const result = issueActivationCode(db, { workerId, ttlDays: args.ttlDays });
    process.stdout.write(
      `\n  ${result.workerId}  ${result.name}\n` +
      `  ACTIVATION CODE: ${result.code}\n` +
      `  expires ${result.expiresAt}\n` +
      "  Shown once. Not stored in plaintext and not recoverable — re-run to issue a new one.\n"
    );
    return true;
  } catch (err) {
    if (err.code === "already_activated") {
      process.stdout.write(`\n  ${workerId}: already activated. Use --force-reset to start over.\n`);
      return false;
    }
    if (err.code === "unknown_worker") {
      process.stdout.write(`\n  ${workerId}: not on the roster. Seed it first.\n`);
      return false;
    }
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.worker && !args.all) {
    usage();
    process.exitCode = 1;
    return;
  }

  // getConfig reads .env the same way the server does, so the CLI and the
  // running backend always agree about which database this is
  const config = getConfig();

  // a production database is not a place to be minting demo credentials by hand
  if (config.isProduction && !args.iKnow) {
    process.stderr.write("refusing to issue activation codes against a production database without --i-know\n");
    process.exitCode = 1;
    return;
  }

  const db = initDatabase(config.dbPath);
  try {
    const targets = args.all
      ? db.prepare(
        `SELECT w.worker_id FROM worker w
         LEFT JOIN trainee_account a ON a.worker_id = w.worker_id
         WHERE a.account_id IS NULL ORDER BY w.worker_id`
      ).all().map((row) => row.worker_id)
      : [args.worker];

    if (targets.length === 0) {
      process.stdout.write("\n  every roster worker already has an account. Nothing to do.\n\n");
      return;
    }

    let issued = 0;
    targets.forEach((workerId) => { if (issueFor(db, workerId, args)) issued += 1; });
    process.stdout.write(`\n  ${issued} code${issued === 1 ? "" : "s"} issued.\n\n`);
  } finally {
    closeDatabase();
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, resetAccount };
