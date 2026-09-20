process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

const { buildTestApp, asTrainee, TEST_CONFIG } = require("./helpers/app");
const {
  issueActivationCode, activateAccount, login, resolveSession,
  checkPinPolicy, lockoutSecondsFor, LOCKOUT_LADDER_SECONDS, SESSION_TTL_DAYS, ACTIVATION_TTL_DAYS
} = require("../services/accounts");
const { generateActivationCode, normalizeActivationCode, hashPin, verifyPin, fingerprint } = require("../services/credentials");

// Trainee authentication, end to end through the router.
//
// The things worth failing over here are not "can a correct PIN sign in" — that
// is the easy half. They are: does a wrong one leak whether the worker exists,
// does a spent code work twice, does a revoked token keep working, and does any
// secret material make it into a response.

const WORKER = "WRK-0001";
const OTHER = "WRK-0002";
const PIN = "846215";
const WRONG_PIN = "735192";

describe("Trainee authentication", () => {
  let ctx = null;

  beforeEach(() => { ctx = buildTestApp(); });
  afterEach(() => ctx.cleanup());

  const code = (workerId = WORKER) => issueActivationCode(ctx.db, { workerId }).code;
  const activate = (body) => request(ctx.app).post("/api/auth/activate").send(body);
  const signIn = (body) => request(ctx.app).post("/api/auth/login").send(body);

  // ---------- activation ----------

  describe("1. activation", () => {
    it("1a. turns a roster worker plus a one-time code into an account", async () => {
      const res = await activate({ workerId: WORKER, code: code(), pin: PIN });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workerId, WORKER);
      assert.ok(res.body.token, "activation signs the worker straight in");
      assert.ok(Date.parse(res.body.expiresAt) > Date.now());
      assert.ok(res.body.name, "the app needs a name to show");
    });

    it("1b. refuses a worker who is not on the roster, in the same words as a bad code", async () => {
      const absent = await activate({ workerId: "WRK-NOBODY", code: generateActivationCode(), pin: PIN });
      const wrong = await activate({ workerId: WORKER, code: generateActivationCode(), pin: PIN });

      assert.strictEqual(absent.status, 401);
      assert.strictEqual(wrong.status, 401);
      assert.strictEqual(absent.body.error.code, "activation_failed");
      assert.strictEqual(absent.body.error.message, wrong.body.error.message,
        "a difference here would turn activation into a roster lookup");
    });

    it("1c. spends the code: the second use fails", async () => {
      const once = code();
      assert.strictEqual((await activate({ workerId: WORKER, code: once, pin: PIN })).status, 200);
      assert.strictEqual((await activate({ workerId: WORKER, code: once, pin: "913746" })).status, 401);
    });

    it("1d. will not let one worker's code activate another worker", async () => {
      const res = await activate({ workerId: OTHER, code: code(WORKER), pin: PIN });
      assert.strictEqual(res.status, 401);
    });

    it("1e. retires an earlier unconsumed code when a new one is issued", async () => {
      const first = code();
      const second = code();
      assert.notStrictEqual(first, second);

      assert.strictEqual((await activate({ workerId: WORKER, code: first, pin: PIN })).status, 401,
        "reissuing is how a lost code is replaced, so the lost one must stop working");
      assert.strictEqual((await activate({ workerId: WORKER, code: second, pin: PIN })).status, 200);
    });

    it("1f. accepts the code however the worker typed it", async () => {
      const issued = code();
      const sloppy = issued.toLowerCase().replace(/-/g, " ");
      assert.strictEqual((await activate({ workerId: WORKER, code: sloppy, pin: PIN })).status, 200);
    });

    it("1g. refuses a PIN that is easy to guess, and does not echo it back", async () => {
      const res = await activate({ workerId: WORKER, code: code(), pin: "123456" });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.code.startsWith("pin_"));
      assert.ok(!JSON.stringify(res.body).includes("123456"));
    });

    it("1h. refuses to issue a code for an account that already exists", () => {
      activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN });
      assert.throws(() => issueActivationCode(ctx.db, { workerId: WORKER }), /already/i);
    });
  });

  // ---------- login ----------

  describe("2. login", () => {
    beforeEach(() => { activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN }); });

    it("2a. signs in a worker with their ID and PIN", async () => {
      const res = await signIn({ workerId: WORKER, pin: PIN });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workerId, WORKER);
      assert.ok(res.body.token);
    });

    it("2b. answers a wrong PIN and an unknown worker identically", async () => {
      const wrongPin = await signIn({ workerId: WORKER, pin: WRONG_PIN });
      const noAccount = await signIn({ workerId: OTHER, pin: PIN });
      const noWorker = await signIn({ workerId: "WRK-NOBODY", pin: PIN });

      [wrongPin, noAccount, noWorker].forEach((res) => {
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.error.code, "invalid_credentials");
      });
      assert.strictEqual(wrongPin.body.error.message, noWorker.body.error.message);
    });

    it("2c. a wrong PIN and an absent account cost about the same time", async () => {
      // the dummy verify exists so a stopwatch cannot answer "is this worker
      // enrolled". a loose bound on purpose: this is a shape check, not a benchmark.
      const time = async (body) => {
        const started = process.hrtime.bigint();
        await signIn(body);
        return Number(process.hrtime.bigint() - started) / 1e6;
      };
      const wrong = await time({ workerId: WORKER, pin: WRONG_PIN });
      const absent = await time({ workerId: "WRK-NOBODY", pin: WRONG_PIN });

      const ratio = Math.max(wrong, absent) / Math.max(1, Math.min(wrong, absent));
      assert.ok(ratio < 10, `login timing must not split on account existence (ratio ${ratio.toFixed(1)})`);
    });

    it("2d. rejects a malformed body without touching the credential path", async () => {
      const res = await signIn({ workerId: WORKER });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "validation_failed");
    });

    it("2e. refuses extra fields rather than ignoring them", async () => {
      const res = await signIn({ workerId: WORKER, pin: PIN, isAdmin: true });
      assert.strictEqual(res.status, 400);
    });
  });

  // ---------- brute force ----------

  describe("3. brute force protection", () => {
    beforeEach(() => { activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN }); });

    it("3a. locks an account out progressively, not permanently", async () => {
      let locked = null;
      for (let i = 0; i < 8; i += 1) {
        const res = await signIn({ workerId: WORKER, pin: WRONG_PIN });
        if (res.status === 429) { locked = res; break; }
      }

      assert.ok(locked, "repeated wrong PINs must eventually be refused outright");
      assert.strictEqual(locked.body.error.code, "too_many_attempts");
      assert.ok(locked.body.error.retryAfterSeconds > 0, "the worker must be told when to come back");
      assert.ok(locked.body.error.retryAfterSeconds <= LOCKOUT_LADDER_SECONDS[LOCKOUT_LADDER_SECONDS.length - 1],
        "the ladder must top out rather than end a worker's training for good");
    });

    it("3b. the correct PIN still works while the account is below the threshold", async () => {
      await signIn({ workerId: WORKER, pin: WRONG_PIN });
      assert.strictEqual((await signIn({ workerId: WORKER, pin: PIN })).status, 200);
    });

    it("3c. a successful sign in clears the counter", async () => {
      await signIn({ workerId: WORKER, pin: WRONG_PIN });
      await signIn({ workerId: WORKER, pin: PIN });
      const row = ctx.db.prepare("SELECT failed_attempts FROM trainee_account WHERE worker_id = ?").get(WORKER);
      assert.strictEqual(row.failed_attempts, 0);
    });

    it("3d. the ladder starts free and grows, then stops", () => {
      assert.strictEqual(lockoutSecondsFor(1), 0, "a worker who fat-fingers once is not locked out");
      assert.ok(lockoutSecondsFor(5) > 0);
      assert.ok(lockoutSecondsFor(9) > lockoutSecondsFor(5));
      assert.strictEqual(lockoutSecondsFor(99), lockoutSecondsFor(9));
    });

    it("3e. a real activation code locks out after repeated misuse", async () => {
      // the counter lives on the code row, so what it protects is a code somebody
      // already holds: a printed slip picked up off a desk cannot be walked
      // through the roster worker by worker looking for whose it is
      const issued = code(OTHER);
      let locked = null;
      for (let i = 0; i < 10; i += 1) {
        const res = await activate({ workerId: WORKER, code: issued, pin: PIN });
        if (res.status === 429) { locked = res; break; }
      }

      assert.ok(locked, "a held code must stop answering after enough wrong guesses");
      assert.ok(locked.body.error.retryAfterSeconds > 0);

      // and the lockout is on the code, not on the worker it belongs to
      ctx.db.prepare("UPDATE trainee_activation SET failed_attempts = 0, locked_until = NULL").run();
      assert.strictEqual((await activate({ workerId: OTHER, code: issued, pin: PIN })).status, 200);
    });
  });

  // ---------- sessions ----------

  describe("4. sessions", () => {
    let session = null;
    beforeEach(() => { session = activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN }); });

    it("4a. answers who the token belongs to", async () => {
      const res = await request(ctx.app).get("/api/auth/me").set(asTrainee(session));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workerId, WORKER);
      assert.ok(!("token" in res.body), "the endpoint must not hand the token back");
    });

    it("4b. refuses a missing, malformed, unknown or non-bearer token identically", async () => {
      const cases = [
        {},
        { Authorization: "Bearer" },
        { Authorization: "Basic abcdef" },
        { Authorization: `Bearer ${"a".repeat(43)}` },
        { Authorization: `Bearer ${session.token}x` }
      ];
      const messages = [];
      for (const headers of cases) {
        const res = await request(ctx.app).get("/api/auth/me").set(headers);
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.error.code, "unauthorized");
        messages.push(res.body.error.message);
      }
      assert.strictEqual(new Set(messages).size, 1, "why a token failed is the server's business, not the caller's");
    });

    it("4c. logout kills the token immediately", async () => {
      assert.strictEqual((await request(ctx.app).post("/api/auth/logout").set(asTrainee(session))).status, 200);
      assert.strictEqual((await request(ctx.app).get("/api/auth/me").set(asTrainee(session))).status, 401);
    });

    it("4d. an expired token stops resolving", () => {
      ctx.db.prepare("UPDATE trainee_session SET expires_at = ?")
        .run(new Date(Date.now() - 1000).toISOString());
      assert.strictEqual(resolveSession(ctx.db, session.token), null);
    });

    it("4e. a disabled account cannot keep using a live token", () => {
      ctx.db.prepare("UPDATE trainee_account SET status = 'disabled' WHERE worker_id = ?").run(WORKER);
      assert.strictEqual(resolveSession(ctx.db, session.token), null);
    });

    it("4f. lasts 30 days", () => {
      const days = (Date.parse(session.expiresAt) - Date.now()) / 86400000;
      assert.ok(Math.abs(days - SESSION_TTL_DAYS) < 0.01);
      assert.strictEqual(SESSION_TTL_DAYS, 30);
    });

    it("4g. is opaque and random, not a JWT", () => {
      assert.ok(!session.token.includes("."), "a dotted token is a JWT and this deliberately is not one");
      assert.ok(session.token.length >= 40);
      const second = login(ctx.db, { workerId: WORKER, pin: PIN });
      assert.notStrictEqual(second.token, session.token, "every sign in mints its own token");
    });

    it("4h. signing in elsewhere does not evict the first device", async () => {
      login(ctx.db, { workerId: WORKER, pin: PIN });
      assert.strictEqual((await request(ctx.app).get("/api/auth/me").set(asTrainee(session))).status, 200,
        "a worker with a phone and a shared tablet must not knock themselves out");
    });
  });

  // ---------- what must never leave the server ----------

  describe("5. secret material", () => {
    it("5a. only a hash of the token is stored", () => {
      const session = activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN });
      const rows = ctx.db.prepare("SELECT token_hash FROM trainee_session").all();

      assert.strictEqual(rows.length, 1);
      assert.notStrictEqual(rows[0].token_hash, session.token);
      assert.strictEqual(rows[0].token_hash, fingerprint(session.token));

      const dump = JSON.stringify(ctx.db.prepare("SELECT * FROM trainee_session").all());
      assert.ok(!dump.includes(session.token), "a stolen database must not be a stolen session");
    });

    it("5b. only a hash of the activation code is stored", () => {
      const issued = code();
      const dump = JSON.stringify(ctx.db.prepare("SELECT * FROM trainee_activation").all());
      assert.ok(!dump.includes(issued));
      assert.ok(!dump.includes(normalizeActivationCode(issued)));
    });

    it("5c. the PIN is stored as scrypt with a per-account salt", () => {
      activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN });
      activateAccount(ctx.db, { workerId: OTHER, code: code(OTHER), pin: PIN });

      const hashes = ctx.db.prepare("SELECT pin_hash FROM trainee_account ORDER BY worker_id").all().map((r) => r.pin_hash);
      hashes.forEach((hash) => {
        assert.ok(hash.startsWith("scrypt$"));
        assert.ok(!hash.includes(PIN));
      });
      assert.notStrictEqual(hashes[0], hashes[1], "the same PIN must not produce the same stored value");
    });

    it("5d. no response carries a hash, a code or a token fingerprint", async () => {
      const issued = code();
      const activated = await activate({ workerId: WORKER, code: issued, pin: PIN });
      const me = await request(ctx.app).get("/api/auth/me")
        .set({ Authorization: `Bearer ${activated.body.token}` });
      const stored = ctx.db.prepare("SELECT pin_hash FROM trainee_account WHERE worker_id = ?").get(WORKER).pin_hash;

      const dump = JSON.stringify(activated.body) + JSON.stringify(me.body);
      [stored, fingerprint(activated.body.token), issued, PIN].forEach((secret) => {
        assert.ok(!dump.includes(secret), "secret material must never appear in a response body");
      });
    });

    it("5e. the dashboard never exposes an account, a code or a session", async () => {
      activateAccount(ctx.db, { workerId: WORKER, code: code(), pin: PIN });
      const res = await request(ctx.app).get("/api/dashboard/compliance")
        .set("x-admin-key", TEST_CONFIG.adminApiKey);

      assert.strictEqual(res.status, 200);
      const dump = JSON.stringify(res.body);
      ["pin_hash", "pinHash", "token_hash", "tokenHash", "code_hash", "codeHash", "verifier", "scrypt$"]
        .forEach((needle) => assert.ok(!dump.includes(needle), `${needle} must not reach the dashboard`));
    });
  });

  // ---------- the primitives underneath ----------

  describe("6. credentials", () => {
    it("6a. an activation code is the documented shape and is not the worker ID", () => {
      const issued = generateActivationCode();
      assert.match(issued, /^SAFEAR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      assert.ok(!/[ILOU]/.test(issued.slice(7)), "crockford drops the letters people misread");
      assert.notStrictEqual(issued, WORKER);
    });

    it("6b. codes do not repeat", () => {
      const seen = new Set();
      for (let i = 0; i < 500; i += 1) seen.add(generateActivationCode());
      assert.strictEqual(seen.size, 500);
    });

    it("6c. normalisation forgives the characters people confuse", () => {
      assert.strictEqual(
        normalizeActivationCode("safear-l0ol-i1i1-2345"),
        normalizeActivationCode("SAFEAR-1O01-1111-2345")
      );
    });

    it("6d. a PIN verifies against its own hash and nothing else", () => {
      const hash = hashPin(PIN);
      assert.strictEqual(verifyPin(PIN, hash), true);
      assert.strictEqual(verifyPin(WRONG_PIN, hash), false);
    });

    it("6e. a malformed stored hash is a failed verification, not a crash", () => {
      ["", "nonsense", "scrypt$", "scrypt$16384$8$1$$", "$$$$"].forEach((broken) => {
        assert.strictEqual(verifyPin(PIN, broken), false);
      });
      assert.strictEqual(verifyPin(PIN, null), false);
    });

    it("6f. the PIN policy rejects what a worker would otherwise pick", () => {
      assert.strictEqual(checkPinPolicy(PIN), null);
      ["", "12345", "111111", "123456", "654321", "000000", "abcdef", "12 34 56"]
        .forEach((bad) => assert.ok(checkPinPolicy(bad), `${JSON.stringify(bad)} must be refused`));
    });

    it("6g. an activation code expires", () => {
      assert.strictEqual(ACTIVATION_TTL_DAYS, 14);
      const issued = code();
      ctx.db.prepare("UPDATE trainee_activation SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
      assert.throws(() => activateAccount(ctx.db, { workerId: WORKER, code: issued, pin: PIN }), /activation/i);
    });
  });
});
