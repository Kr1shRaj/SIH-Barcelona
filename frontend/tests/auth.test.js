import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(HERE, "..");
const readFile = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

// a localStorage that behaves like the real one, including throwing nothing
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; },
    has: (key) => map.has(key)
  };
}

const storage = memoryStorage();

// the browser globals session.js reaches for, before it is imported. node
// already owns globalThis.crypto and will not let it be reassigned, so the
// window object carries the one session.js actually picks up.
globalThis.window = { localStorage: storage, crypto: webcrypto };
globalThis.localStorage = storage;

let session = null;

before(async () => {
  session = await import("../js/session.js");
});

const SERVER_SESSION = Object.freeze({
  token: "hN3q8VuRr0pXmBzKlT4eWgYcS7dAfJ2iQxLvOu5nPbE",
  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  workerId: "WRK-0001",
  name: "Ramesh Kumar"
});

const PIN = "846215";

describe("Trainee session on the device", () => {
  beforeEach(() => {
    session.clearSession({ forgetDevice: true });
  });

  // ---------- the session token ----------

  describe("1. the server session", () => {
    it("1a. a device with nothing stored is nobody", () => {
      assert.strictEqual(session.getToken(), null);
      assert.strictEqual(session.getWorkerId(), null);
      assert.strictEqual(session.isSessionFresh(), false);
      assert.strictEqual(session.canReenterOffline(), false);
    });

    it("1b. remembers a sign in and reports who it belongs to", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);

      assert.strictEqual(session.getToken(), SERVER_SESSION.token);
      assert.strictEqual(session.getWorkerId(), "WRK-0001");
      assert.strictEqual(session.isSessionFresh(), true);
    });

    it("1c. a token past its stated expiry is not fresh", async () => {
      await session.rememberSession(
        { ...SERVER_SESSION, expiresAt: new Date(Date.now() - 1000).toISOString() },
        PIN
      );
      assert.strictEqual(session.isSessionFresh(), false);
    });

    it("1d. corrupted storage reads as signed out rather than throwing", () => {
      storage.setItem(session.SESSION_KEY, "{ not json");
      storage.setItem(session.IDENTITY_KEY, "{ not json");

      assert.strictEqual(session.getToken(), null);
      assert.strictEqual(session.getIdentity(), null);
      assert.strictEqual(session.canReenterOffline(), false);
    });

    it("1e. signing out drops the token but keeps the device's identity", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);
      session.clearSession();

      assert.strictEqual(session.getToken(), null);
      assert.strictEqual(session.getWorkerId(), "WRK-0001", "the phone still knows whose it is");
      assert.strictEqual(session.canReenterOffline(), true, "so the next prompt asks for a PIN, not an ID");
    });

    it("1f. forgetting the device drops both", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);
      session.clearSession({ forgetDevice: true });

      assert.strictEqual(session.getIdentity(), null);
      assert.strictEqual(session.canReenterOffline(), false);
    });
  });

  // ---------- the offline verifier ----------

  describe("2. the device-local verifier", () => {
    it("2a. is not the PIN, and is not anything the server stores", async () => {
      const identity = await session.rememberSession(SERVER_SESSION, PIN);

      assert.ok(identity.verifier && identity.verifierSalt);
      assert.ok(!identity.verifier.includes(PIN));
      assert.strictEqual(identity.algo, "PBKDF2-SHA256",
        "the server uses scrypt; copying its hash here would make one theft into two");
      assert.strictEqual(identity.iterations, session.PBKDF2_ITERATIONS);

      const dump = JSON.stringify(identity);
      assert.ok(!dump.includes(PIN), "the PIN itself must never be written down");
      assert.ok(!dump.includes("scrypt"));
    });

    it("2b. salts per device, so two phones with the same PIN store different values", async () => {
      const first = await session.rememberSession(SERVER_SESSION, PIN);
      const firstVerifier = first.verifier;
      session.clearSession({ forgetDevice: true });
      const second = await session.rememberSession(SERVER_SESSION, PIN);

      assert.notStrictEqual(first.verifierSalt, second.verifierSalt);
      assert.notStrictEqual(firstVerifier, second.verifier);
    });

    it("2c. accepts the right PIN offline", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);
      const result = await session.verifyOfflinePin(PIN);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.workerId, "WRK-0001");
      assert.strictEqual(result.name, "Ramesh Kumar");
    });

    it("2d. refuses the wrong one", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);
      const result = await session.verifyOfflinePin("735192");

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, "wrong_pin");
    });

    it("2e. a cached account with no verifier is not a way in", async () => {
      // this is the whole point of the design: the record says who the phone
      // belongs to, and says nothing about whether the person holding it is them
      await session.rememberSession(SERVER_SESSION, null);

      assert.strictEqual(session.getWorkerId(), "WRK-0001");
      assert.strictEqual(session.canReenterOffline(), false);

      const result = await session.verifyOfflinePin(PIN);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, "no_verifier");
    });

    it("2f. wipes the verifier after enough wrong guesses, and says so", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);

      let last = null;
      for (let i = 0; i < session.OFFLINE_MAX_ATTEMPTS; i += 1) {
        last = await session.verifyOfflinePin("735192");
      }

      assert.strictEqual(last.reason, "locked");
      assert.strictEqual(session.canReenterOffline(), false,
        "a phone somebody picked up must stop offering guesses");

      // and the right PIN no longer helps: the only way back is the server
      const rightPin = await session.verifyOfflinePin(PIN);
      assert.strictEqual(rightPin.ok, false);
      assert.strictEqual(session.getWorkerId(), "WRK-0001", "though the app still knows who to ask for");
    });

    it("2g. a correct PIN clears the failure count", async () => {
      await session.rememberSession(SERVER_SESSION, PIN);
      await session.verifyOfflinePin("735192");
      await session.verifyOfflinePin("735192");
      await session.verifyOfflinePin(PIN);

      assert.strictEqual(session.getIdentity().failedOffline, 0);
    });

    it("2h. the same PIN and salt always derive the same bytes", async () => {
      const salt = new Uint8Array(16).fill(7);
      const a = await session.deriveVerifier(PIN, salt, 1000);
      const b = await session.deriveVerifier(PIN, salt, 1000);
      const c = await session.deriveVerifier("735192", salt, 1000);

      assert.deepStrictEqual(Array.from(a), Array.from(b));
      assert.notDeepStrictEqual(Array.from(a), Array.from(c));
      assert.strictEqual(a.length, 32);
    });

    it("2i. the cost is high enough to be worth something on a stolen phone", () => {
      assert.ok(session.PBKDF2_ITERATIONS >= 210000);
    });
  });

  // ---------- what the queue must survive ----------

  describe("3. the attempt queue is not session state", () => {
    it("3a. signing out leaves queued work alone", async () => {
      storage.setItem("safear_attempt_queue", JSON.stringify([{ attemptId: "abc" }]));
      await session.rememberSession(SERVER_SESSION, PIN);

      session.clearSession({ forgetDevice: true });

      assert.ok(storage.has("safear_attempt_queue"),
        "a worker who finished a module and handed the phone back must not lose it");
    });

    it("3b. and nothing in session.js names the queue", () => {
      const src = readFile("js/session.js");
      assert.ok(!/queue/i.test(src.replace(/\/\/.*$/gm, "")),
        "the only mention of the queue in this file is the comment explaining why it is untouched");
    });
  });
});

// ---------- the screen ----------

describe("4. the sign in screen", () => {
  const src = readFile("screens/auth.js");

  it("4a. is one screen in three states, not three screens", () => {
    assert.ok(src.includes('const MODES = ["login", "activate", "offline"]'));
    assert.ok(src.includes("renderAuthHtml"));
  });

  it("4b. carries the real SafeAR mark, not a substitute", () => {
    assert.ok(src.includes('"./assets/brand/safear-logo.png"'));
    assert.ok(fs.existsSync(path.join(FRONTEND, "assets/brand/safear-logo.png")));
    assert.ok(!/<svg|🛡|&#x1F6E1/.test(src), "no invented mark may stand in for the logo");
  });

  it("4c. uses the app's own bar controls, so language and theme work here too", () => {
    assert.ok(src.includes("renderAppBarControls"));
    assert.ok(src.includes("bindAppBar"));
    assert.ok(src.includes("onLocaleChange"));
  });

  it("4d. every string reaches the screen through a locale key", () => {
    const literals = src.match(/>\s*[A-Z][a-z]+ [a-z][^<>{}]*</g) || [];
    assert.deepStrictEqual(literals, [], "no hard-coded English may be rendered");
    ["auth.login_title", "auth.activate_title", "auth.offline_title", "auth.worker_id", "auth.pin"]
      .forEach((key) => assert.ok(src.includes(key), `${key} must be looked up`));
  });

  it("4e. sends a sign in without whatever token was already on the device", () => {
    assert.ok(src.includes("authToken: null"),
      "a stale bearer on a login request is how you end up refreshing somebody else's session");
  });

  it("4f. never renders a PIN, a code or a token back into the page", () => {
    assert.ok(!/value="\$\{[^}]*pin/i.test(src));
    assert.ok(!/value="\$\{[^}]*code/i.test(src));
    assert.ok(!/value="\$\{[^}]*token/i.test(src));
    assert.ok(!/logger\.(info|warn|error)\([^)]*\b(pin|code|token)\b\s*[,}]/.test(src),
      "and none of them may reach a log line");
  });

  it("4g. the offline route never calls the network", () => {
    const offline = src.slice(src.indexOf('if (current === "offline")'), src.indexOf("const workerId = value"));
    assert.ok(offline.includes("verifyOfflinePin"));
    assert.ok(!/apiPost|fetch\(/.test(offline));
  });

  it("4h. an offline entry claims no server session", () => {
    assert.ok(src.includes("offline: true"));
    const offline = src.slice(src.indexOf('if (current === "offline")'), src.indexOf("const workerId = value"));
    assert.ok(!offline.includes("rememberSession"),
      "the device vouching for a worker is not the server having issued a token");
  });

  it("4i. the PIN fields are masked and numeric", () => {
    // every line that declares a PIN field, whichever of the three states it is for
    const pinFields = src.split("\n").filter((line) => /_field\(\{ id: "auth-pin2?"/.test(line));
    assert.ok(pinFields.length >= 4, "login, activation and the offline prompt all ask for one");
    pinFields.forEach((field) => {
      assert.ok(field.includes('type: "password"'), "a PIN is never shown on screen");
      assert.ok(field.includes('inputMode: "numeric"'), "and a phone must offer the number pad");
    });
  });

  it("4l. does not offer to sign out of the screen you sign in on", () => {
    assert.ok(src.includes("renderAppBarControls(undefined, undefined, false)"),
      "the device remembers a worker here, which is not the same as being signed in");
  });

  it("4k. survives a repaint, so a credential is never submitted as a GET", () => {
    // paint() replaces the container's markup. A handler bound to the form node
    // dies with it, and an unhandled submit is a native GET — which is how the
    // PIN and the activation code ended up in the address bar during the first
    // browser run of this screen. Both listeners belong to the container.
    assert.ok(src.includes('container.addEventListener("submit", onSubmit)'));
    assert.ok(!/form\.addEventListener\("submit"/.test(src),
      "binding to the form node does not survive a mode switch or a language change");
    assert.ok(src.includes("container.removeEventListener(\"submit\", onSubmit)"),
      "and it must come off again when the screen is torn down");
    assert.ok(src.includes("event.preventDefault()"));
  });

  it("4j. escapes everything it interpolates", () => {
    assert.ok(src.includes("function _esc("));
    const interpolations = src.match(/\$\{(?!_esc|fields|who|alternate|message \?|active|options)[^}]+\}/g) || [];
    const unescaped = interpolations.filter((raw) => /identity\.|\.name|\.workerId/.test(raw));
    assert.deepStrictEqual(unescaped, [], "a name off the wire goes through _esc");
  });
});

describe("5. the sign in screen looks like the rest of SafeAR", () => {
  const css = readFile("css/prerequisite.css");
  const block = css.slice(css.indexOf("/* ---------- sign in ----------"), css.indexOf("/* ---------- the in-app bar"));

  it("5a. exists", () => {
    assert.ok(block.length > 500, "the screen must actually be styled");
    [".auth-screen", ".auth-card", ".auth-brand", ".auth-logo", ".auth-title", ".auth-form",
      ".auth-field", ".auth-message", ".auth-link", ".auth-controls"]
      .forEach((selector) => assert.ok(block.includes(selector), `${selector} is missing`));
  });

  it("5b. takes every colour from the theme tokens, so both themes work", () => {
    const colours = block.match(/(?:color|background|border[^:]*|box-shadow):[^;]+;/g) || [];
    const literal = colours.filter((decl) => /#[0-9a-f]{3,8}|\brgb/i.test(decl));
    assert.deepStrictEqual(literal, [], "no literal colour may be written into this layer");
  });

  it("5c. uses no blue, cyan, purple, gradient or glass", () => {
    assert.ok(!/#38bdf8|#0ea5e9|#3b82f6|gradient|backdrop-filter|blur\(/i.test(block));
  });

  it("5d. centres the title and gives the controls a real touch target", () => {
    assert.ok(block.includes("text-align: center"));
    assert.ok(block.includes("var(--eq-tap)"), "48px targets come from the existing token");
  });

  it("5e. clears the status bar and the gesture bar", () => {
    assert.match(block, /env\(safe-area-inset-top/);
    assert.match(block, /env\(safe-area-inset-bottom/);
  });
});

describe("6. the app opens on the right screen", () => {
  const app = readFile("js/app.js");
  const flow = app.slice(app.indexOf("function startScreenFlow"));

  it("6a. a live session goes straight into training", () => {
    assert.match(flow, /if \(isSessionFresh\(\)\) \{\s*return showScreen\("language"\);/);
  });

  it("6b. everybody else is asked, and a remembered device is not an answer", () => {
    assert.ok(flow.includes("mountAuthScreen"));
    assert.ok(!flow.includes("canReenterOffline"),
      "a cached record must not be able to open the flow on its own");
  });

  it("6c. signing out comes back to the sign in screen without a reload", () => {
    const bar = readFile("screens/appbar.js");
    assert.ok(bar.includes('data-action="sign-out"'));
    assert.ok(bar.includes("SIGN_OUT_EVENT"));
    assert.ok(!/location\.reload|window\.location/.test(bar));
    assert.ok(flow.includes("SIGN_OUT_EVENT"));
  });

  it("6d. the bar only offers sign out to somebody who is signed in", () => {
    const bar = readFile("screens/appbar.js");
    assert.ok(bar.includes("function _isSignedIn()"));
    assert.ok(bar.includes("${signedIn ?"));
  });

  it("6e. identity is read per screen, not frozen at boot", () => {
    assert.ok(!flow.includes("const workerId = getEffectiveWorkerId()"),
      "a worker who signs in after boot must be the worker the screens are built for");
    assert.ok(flow.includes("workerId: getEffectiveWorkerId()"));
  });
});

describe("7. the auth modules ship offline", () => {
  const sw = readFile("sw.js");

  it("7a. the screen and the session store are precached", () => {
    assert.ok(sw.includes('"./screens/auth.js"'));
    assert.ok(sw.includes('"./js/session.js"'));
  });
});
