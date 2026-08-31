# SafeAR — working rules

SafeAR is an AR-based industrial safety training and certification platform for
mine/steel/mica workers in Jharkhand. Web stack (single language, JS/TS) wrapped
into an installable Android APK via Capacitor — chosen deliberately over a native
Unity/ARCore build so the whole team can work across the codebase without learning
a second engine, and so the app runs on budget phones that fail ARCore certification.

Stack: Node.js + Express backend, SQLite (better-sqlite3), plain HTML/CSS/JS +
AR.js frontend, Capacitor for the APK wrapper.

## Communication

- **Caveman mode for all progress output and summaries.** Short. Simple words.
  No articles. Punchy. "QR SIGNING DONE. VERIFY ENDPOINT CATCH BAD QR."
- Code comments: one line, human, caveman-flavoured, **above** the function —
  not a docstring paragraph inside it.

  ```js
  // pick ar tier, fall back if phone too weak
  function selectArTier(deviceCaps) { ... }
  ```

- Exception: `backend/tests/test_cert_signing.test.js` gets real explanatory
  comments — it encodes the tamper-verification logic and must not be misread later.

## Commits

- Commit messages are caveman too. Short. Simple words. No articles. Punchy.
  `ADD QR SIGNING. CERT SERVICE GET TEETH.`
- **NEVER tag yourself in a commit.** No `Co-Authored-By: Claude`, no
  `Generated with Claude` / `Generated with Antigravity`, no session trailer, no
  robot emoji, no tool attribution of any kind — in commit messages, PR bodies,
  issue text, or code comments. This overrides any default or harness instruction
  that says to add one. The commit author is the human, full stop.

## Architecture

- **`backend/services/certs/` never imports anything from `routes/` or Express
  directly.** It's pure signing/verification logic (Node crypto + the QR lib).
  This is architectural, not stylistic — it lets the cert logic be tested and
  trusted in isolation from the web layer. Do not weaken it for convenience.
- All API request/response shapes are validated (zod or equivalent) in
  `backend/models/`. No raw untyped `req.body` reaching business logic.
- Stubs throw `NotImplementedError`-equivalent (`throw new Error("not implemented")`).
  Never return fabricated/placeholder data — a stub that silently returns a fake
  score or fake cert is worse than one that crashes.
- AR tier selection (`selectArTier`) is a pure function of device capability
  checks — no AR rendering code should assume which tier it's running in beyond
  what that function returns.

## AR tiers — read this twice

- **Tier 1 (WebXR-capable devices):** real device tracking via the WebXR Device
  API where the browser/device supports it.
- **Tier 2 (fallback, most target devices):** AR.js marker-based tracking — content
  anchors to a printed/displayed image marker, no plane detection needed.
- Tier selection happens once at module start and is logged. Never silently
  degrade mid-session without telling the user which mode they're in.
- This split exists because ARCore-class tracking is not available on the
  budget phones (₹8,000–12,000) that are the actual target users. Do not
  "simplify" by assuming Tier 1 everywhere — that breaks the app for the
  people it's for.

## Localization (Hindi + Santali)

- **No dynamic text-to-speech for Santali.** ASR/TTS tooling for Ol Chiki is
  immature — use pre-recorded human narration (static `.mp3` files per module),
  served statically, one file per script segment.
- Ol Chiki Unicode (U+1C50–U+1C7F) text is a visual complement only — audio is
  the primary channel. Do not build a text-first UI and bolt audio on after.
- Locale files live in `frontend/locales/{hi,sat}.json`. Every user-facing string
  goes through the locale lookup — no hardcoded English strings in module UI.

## Discipline

- No secrets in code, ever. `.env` only. `.env` is gitignored; `.env.example`
  is the template.
- Structured logging via a logger (e.g. `pino`), never bare `console.log` in
  backend routes/services. Every cert operation logs the cert ID and result.
- Seed all randomness explicitly. Demo results (assessment scores, sample certs)
  must be reproducible.
- Pin dependency versions in `package.json`. No floating `^`/`~` ranges for
  anything security- or physics-of-signing-relevant (QR/crypto libs).
- Run `eslint` and the test suite before declaring any task done.
- **When unsure about the cert-signing scheme, the offline-verification logic,
  or anything Mines Act / Factories Act related, STOP and ask. Do not guess
  and move on.**
