# SafeAR

AR-based safety training and certification platform for mining, steel and mica
sector workers in Jharkhand — built for SIH 2026.

> **State as of 24 Sep 2026 (branch `Module_Content1` @ `0fe4e9b`).** This
> README describes what the code does today, not the original plan. The original
> scope still lives in `REQUIREMENTS.md`. Where the two differ, this file is
> right and that one is aspirational.

## The one-paragraph truth

The training app runs in a browser and has two AR modules. **Fire & Explosion
Response** is the deep one: a methane-reading decision, two scenario branches,
GLB models, and — in Tier 1 (WebXR) only — tap-to-place with wall alignment,
a resizable exit sign and physical walk-to-exit. **Gas Leak & Confined Space**
is a linear three-step module with none of that work. The backend signs
certificates with Ed25519 and verifies them, and all three test suites pass.
**But no solo module can currently produce a certificate**, the **APK has never
been built**, the **admin compliance dashboard is not reachable from the served
page**, and **Santali is roughly 60% translated with placeholder-length audio**.
Details below.

## Problem

Classroom-based safety training (static manuals) has under-20% retention after
a week. Live drills disrupt operations. VR headsets are inaccessible to small
mines and contract workers. Physical safety certificates have no way to verify
the holder actually understood the material. DGMS recorded 48 fatal mine
accidents in Jharkhand in 2022–23, many involving workers with under 30 days
of orientation.

## Stack

- **Frontend:** plain HTML/CSS/JS ES modules. A-Frame + AR.js (vendored in
  `frontend/vendor/`) for Tier 2; Three.js + WebXR Device API for Tier 1.
  Service worker (`frontend/sw.js`, cache `safear-offline-v33`) for offline.
- **APK wrapper:** Capacitor 5.7.4 (`capacitor.config.json`, `webDir: frontend`).
- **Backend:** Node.js + Express 4, `zod` validation, `pino` logging, `ws` for
  the team-drill room server.
- **Database:** SQLite via `better-sqlite3` (`backend/data/safear.db`, gitignored).
- **Certs:** Ed25519 (Node `crypto`) + `qrcode`. Signing lives in
  `backend/services/certs/`, which imports nothing from Express or `routes/`.
- **Localization:** `frontend/locales/{en,hi,sat}.json` + static `.mp3`
  narration per module step. No dynamic TTS (see `AGENTS.md`).

## Project structure (actual)

The old README showed a "planned" tree. This is what exists:

```
SIH/
├── AGENTS.md                  # build rules — read first
├── REQUIREMENTS.md            # original scope (aspirational, partly stale)
├── REQUIREMENTS_MOBILE_APP.md # spec for the dashboard/mobile portal
├── IMPLEMENTATION_MOBILE_APP.md, CHANGES_SUMMARY.md   # branch change notes
├── capacitor.config.json
├── eslint.config.mjs
├── package.json               # npm workspaces: backend, frontend, dashboard
├── backend/
│   ├── app.js, server.js, config.js, logger.js
│   ├── db/                    # schema.sql, seed.js (modules + checkpoint answer keys)
│   ├── keys/                  # cert-signing.public.pem (committed on purpose)
│   ├── middleware/            # admin-auth, error
│   ├── models/                # zod shapes: attempt, cert, module, sync
│   ├── realtime/              # team-session.js — WebSocket team-drill rooms
│   ├── routes/                # /api/modules, /api/sync, /api/certs, /api/dashboard
│   ├── scripts/keygen.js
│   ├── services/
│   │   ├── certs/             # canonical, signer, verifier, keys, issue
│   │   ├── grading/           # server-side re-grading of every attempt
│   │   ├── team-drill/        # pure scoring for the team drill
│   │   ├── attempts.js, modules.js, dashboard.js
│   └── tests/
├── frontend/
│   ├── index.html, config.js, sw.js
│   ├── ar/                    # tier.js (selectArTier), webxr.js, webxr_render.js,
│   │                          # marker.js, marker-pose.js, alignment.js, interactions.js
│   ├── assessment/            # engine.js (session + scoring), observations.js
│   ├── modules/
│   │   ├── fire-response/     # fire-response.js (Tier 2 + team), webxr_fire_module.js
│   │   │                      # (Tier 1), decision.js, graphics.js, distance.js, team-session.js
│   │   └── gas-leak/          # gas-leak.js (both tiers), graphics.js
│   ├── prerequisite/          # equipment familiarization screen (before a module)
│   ├── screens/               # splash, language, modules, router
│   ├── js/                    # app, api, i18n, audio, certificates, module-loader, logger
│   ├── locales/               # en.json, hi.json, sat.json + SANTALI_TRANSLATION_MANIFEST.md
│   ├── audio/{en,hi,sat}/     # 6 step clips each + RECORDING_MANIFEST.md
│   ├── assets/                # models/*.glb, images/, brand/
│   ├── markers/               # hiro.html, kanji.html (printable Tier 2 markers)
│   ├── vendor/                # aframe, aframe-ar, AR.js pattern data
│   └── tests/
├── dashboard/
│   ├── index.html             # redirects to /mobile/ — see "Dashboard" below
│   ├── js/dashboard.js        # admin compliance dashboard (tested, but orphaned)
│   └── mobile/                # "Training Portal" demo (localStorage only)
├── android/                   # README.md only — no generated project, no APK
├── 3D_MODELS/, 2d images/     # raw source assets (not served)
```

Differences from the old "planned" tree: `frontend/audio/` holds `en/` too;
`assessment/`, `prerequisite/`, `screens/`, `backend/realtime/` and
`services/grading/` did not exist in the plan; `dashboard/` is now a mobile
portal rather than the admin dashboard; `android/` has never held a project.

## AR tiers

`selectArTier` (`frontend/ar/tier.js`) is a pure function of device caps:

| Tier | When | Engine |
| --- | --- | --- |
| 1 | secure context + `navigator.xr` + `immersive-ar` supported + camera | WebXR hit-test, Three.js |
| 2 | camera available but no WebXR (most target phones), or WebXR session failed | A-Frame + AR.js marker (Hiro / Kanji) |
| 0 | no camera access | unsupported-device screen |

Override for testing: `?tier=1`, `?tier=2` (or `?mode=webxr` / `?mode=marker`).

### Fire module — what each tier supports today

| Feature | Tier 1 (WebXR) | Tier 2 (marker) |
| --- | --- | --- |
| Methane gas gauge + decision wheel | yes | yes |
| Branching: A = evacuate, B = alarm + suppress | yes | yes |
| GLB models (fire, extinguisher, exit sign, alarm pull station) | yes (Three.js `GLTFLoader`) | yes (A-Frame `gltf-model`) |
| Tap-to-place with wall-angle alignment | yes — hit-test, sign rotates flush to detected wall | no — content anchors to the marker |
| User-resizable exit sign (+/−, 0.5×–2.0×) | yes | no |
| Physical walk-to-exit completion (branch A) | yes, with a "small room" fallback button | no — evacuation is a selection |
| P.A.S.S. extinguisher sequence | yes (gaze aim, squeeze, sweep coverage) | yes |
| Debrief card | yes | yes |
| Assessment attempt recorded + certificate requested | **no — see Known issues #1** | yes |
| Team drill (multiplayer, WebSocket) | routed through the Tier 2 code path | yes |

All recent fire work (commits `8460109` → `0fe4e9b`: resize, wall angle,
walk-to-exit, crosshair lock, rig drift) landed in **Tier 1 only**.

### Gas-leak module

**Has not received any of the above.** No decision gauge, no branching, no
tap-to-place, no resize, no walk-to-exit, no debrief card. It is a linear
three-step flow (hazard zone → PPE selection → buddy procedure) run by one file,
`gas-leak.js`, for both tiers. Tier 2 shows GLB models on the marker; Tier 1
adds a hazard/PPE mesh via the WebXR controller but has no dedicated WebXR
module like fire does.

## Certification

- **Signing:** Ed25519. Payload canonicalized (`services/certs/canonical.js`),
  signed, rendered as a QR. Tamper verification (modified field, wrong key) is
  covered in `backend/tests/test_cert_signing.test.js` and passes.
- **Gate:** the server re-grades every synced attempt against the answer keys in
  `backend/db/seed.js`. The client's own score is never trusted.
- **Current state: blocked for both solo modules.** Unchanged since the
  12 Sep audit:
  - `fire_exit_identification` and `gas_hazard_zone_recognition` are seeded
    `gradeable: 0` (no angular tolerance measured on real hardware). One
    ungradeable checkpoint makes the whole attempt ungradeable, and issuance
    refuses it with 422.
  - New since then: the fire decision wheel fires checkpoint
    `fire_explosion_decision`, which is **not in the seed**. The server's
    manifest check rejects unknown checkpoints, so a fire attempt that includes
    it is likely rejected at sync before grading even runs. No test syncs this
    checkpoint end to end.
- **Team drill** (`fire-response-team`): all five checkpoints are
  `gradeable: 1`, so this is the one path that can currently issue a cert.

## Localization

| Locale | UI strings vs `en.json` (364 keys) | Step narration audio (6 clips) |
| --- | --- | --- |
| `en` | 364 | present, ~6–7 s each, ElevenLabs-generated (C2PA metadata says so) |
| `hi` | 364 — complete | present, ~7–10 s each, ElevenLabs-generated |
| `sat` | 216 — **148 missing** (74 equipment, 34 module, 23 prerequisite, 13 fire, 4 app) | present, but **~2–2.7 s each** at 64 kbps — far too short to carry the script; provenance undocumented |

- Missing Santali keys are left out on purpose and shown as untranslated (see
  `frontend/locales/SANTALI_TRANSLATION_MANIFEST.md`). 62 more `sat` values are
  identical to English.
- Equipment-familiarization narration (12 clips) is **not recorded** in any
  language (`frontend/audio/RECORDING_MANIFEST.md`); the listen button stays
  disabled.
- `AGENTS.md` calls for pre-recorded **human** narration. The `en`/`hi` clips
  are AI-generated, not human recordings.
- Much of the fire-module UI (HUD badges, branch titles, debrief text) is
  hardcoded English in the JS, especially in `webxr_fire_module.js`, so a Hindi
  or Santali user still sees English at decision points.

## Dashboard

`dashboard/index.html` now redirects straight to `/mobile/`, a "Training
Portal" with supervisor/worker views and a 3-stage unlock. That portal:

- stores everything in `localStorage` — it does not call the backend;
- **accepts any ID + PIN** ("For demo, accept any credentials");
- uses hardcoded personas and module catalog from `mobile/js/state.js`.

The real admin compliance dashboard (`dashboard/js/dashboard.js`, reads
`/api/dashboard` with `ADMIN_API_KEY`) still exists and its 61 tests pass, but
**no HTML page loads it** any more.

## Android / APK

- `android/` contains only `README.md`. No project has been generated in this
  clone and **no APK has ever been built**.
- The **CAMERA permission** is not added anywhere in the repo. A default
  `cap add android` manifest declares only `INTERNET`, so AR will not get the
  camera in the APK until someone adds it after generating the project.
- Cleartext HTTP to a LAN backend relies on `server.cleartext: true` in
  `capacitor.config.json`. That should be applied at `cap sync`, but has never
  been checked on a device.
- `frontend/config.js` ships with an empty `SAFEAR_API_BASE` (correct — set it
  locally before building, do not commit it).

## Tests and lint

Run on 24 Sep 2026 against this branch:

| Suite | Command | Result |
| --- | --- | --- |
| Backend | `npm run test:backend` | 601 / 601 pass |
| Frontend | `npm run test:frontend` | 695 / 695 pass |
| Dashboard | `npm run test:dashboard` | 61 / 61 pass (tests the orphaned admin dashboard) |
| ESLint | `npm run lint` | clean |

The backend boots and `/api/health` answers `{ "ok": true, "db": "up" }` with
the setup below.

## Known issues and in-progress work

1. **Tier 1 solo fire runs are never recorded.** `webxr_fire_module.js` never
   calls `finishAssessmentSession`; the debrief "Exit" button calls
   `unloadModule()`, which aborts the session. No attempt is queued, synced or
   certified. Tier 2 does this correctly.
2. **No solo certificate can issue** — two `gradeable: 0` checkpoints plus the
   unseeded `fire_explosion_decision` checkpoint (see Certification).
3. **APK never built; camera permission missing** (see Android).
4. **Admin dashboard unreachable** from the served page (see Dashboard).
5. **Santali incomplete** — 148 keys missing, step audio ~2 s long,
   equipment narration unrecorded in every language.
6. **Gas-leak has none of the fire-module interaction work.**
7. **Tier 2 fire lacks** resize, wall alignment and physical walk-to-exit —
   by design of marker tracking for the first two; the third is simply not done.
8. `frontend/package.json` pins `@capacitor/android` as `^5.7.4` — a floating
   range, against the pinning rule in `AGENTS.md`.
9. Unmerged remote branches exist (`origin/AR-Layer`, `origin/Content_Expansion`,
   `origin/Dashboard_APK`, `origin/Fire_Explosion`, `origin/assessment`,
   `origin/Backend`); whether their work is on `main` has not been re-checked
   here.

## Backend Local Setup

Do this once per clone. Every step is checked at boot, so skipping one fails
immediately and says which variable is missing rather than misbehaving later.

Commands are given for PowerShell and for bash/zsh where they differ. Run them
from the repository root.

### 1. Copy the environment template

```powershell
Copy-Item .env.example .env
```

```bash
cp .env.example .env
```

`.env` is gitignored. It holds every secret the backend has, and it never gets
committed, pasted into chat, or put in a screenshot.

### 2. Install dependencies

```bash
npm install
```

One install at the root covers all three workspaces — `backend/`, `frontend/`
and `dashboard/`.

### 3. Generate your development signing key

```bash
npm run keygen:dev
```

This writes a gitignored public key to
`backend/keys/cert-signing.dev.public.pem` and prints two lines to paste into
`.env`. It does not touch the shared team key.

> **Do not run `npm run keygen` for setup.** That one rotates the *team* signing
> key, and every certificate already issued stops verifying. It refuses to
> overwrite an existing key for exactly that reason. See
> [Team key vs dev key](#team-key-vs-dev-key) below.

### 4. Set `CERT_PRIVATE_KEY`

Paste the `CERT_PRIVATE_KEY=...` line that `keygen:dev` printed into `.env`,
replacing the `change_me_...` placeholder.

This is the only thing that can mint a certificate. It lives in `.env` and
nowhere else.

### 5. Set `ADMIN_API_KEY`

Pick your own value — there is no shared team admin key, and one must never be
committed. Any long random string works:

```powershell
[guid]::NewGuid().ToString()
```

```bash
openssl rand -hex 24
```

Leaving the placeholder logs a warning in development and is a hard boot failure
in production. Both are deliberate.

### 6. Verify `CERT_PUBLIC_KEY_PATH`

Set it to the public half of whichever key you are using:

| Working how | `CERT_PUBLIC_KEY_PATH` |
| --- | --- |
| Alone, with your own dev key | `./keys/cert-signing.dev.public.pem` |
| With the team's shared key | `./keys/cert-signing.public.pem` |

`keygen:dev` prints the first of these for you. The private key and this file
must be two halves of one pair; they are checked against each other at boot and
a mismatch fails loudly rather than producing certificates nobody can verify.

### 7. Create the demo data

```bash
npm run seed
```

This creates `backend/data/safear.db` and fills it with the demo workers,
modules and checkpoint manifest. Without it the database has no workers and
every attempt sync comes back `unknown_worker`.

The database file is local and gitignored. If you pull a branch with a newer
schema, the backend refuses to start and names the version it expected — delete
the file and re-seed:

```powershell
Remove-Item backend/data/safear.db
npm run seed
```

```bash
rm backend/data/safear.db
npm run seed
```

### 8. Start the backend

```bash
npm run dev:backend
```

### 9. Health check

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

```bash
curl http://localhost:3000/api/health
```

A healthy backend answers:

```json
{ "ok": true, "db": "up", "ts": "...", "requestId": "..." }
```

If it does not start, the error names the missing or invalid variable. Secrets
are never printed.

### Team key vs dev key

The two halves of an Ed25519 signing key are handled differently, and it
matters:

- The **private key** (`CERT_PRIVATE_KEY`) is a secret. It lives only in `.env`.
  Never commit it, never share it, never paste it into a chat.
- The **public key** is not a secret and is meant to be distributed.
  `backend/keys/cert-signing.public.pem` is committed on purpose so every machine
  verifies against the same issuer.

A **dev key** (`npm run keygen:dev`) is yours alone. Certificates you sign with
it verify on your machine and nowhere else, which is the point — a development
key must not be able to mint something the team would trust. It is enough for
building and testing the whole flow end to end on one laptop.

The **team key** (`npm run keygen`) is the shared issuer. For a demo spanning two
machines, one person generates it, commits the public half, and passes the
`CERT_PRIVATE_KEY` line to the others out of band. If each teammate generates
their own instead, a certificate issued on one laptop fails verification on
another with `bad_signature`.

Development signing keys and any production key are separate. Nothing generated
by `keygen:dev` should ever reach a real deployment.

## How the app finds the backend

The frontend resolves the backend address in this order, first match winning:

| Source | Use it for |
| --- | --- |
| `?api=http://host:3000` in the URL | A one-off override; it is remembered afterwards |
| Previously remembered value | Reloads after the override above |
| `window.SAFEAR_API_BASE` in `frontend/config.js` | APK builds |
| Frontend on port 5173 | Ordinary local development — nothing to configure |
| Same origin | A deployment where the backend serves the frontend |

Only `http` and `https` addresses are accepted, and a trailing slash is trimmed.

If no backend is reachable, nothing is lost. Attempts stay queued, certificates
stay pending, and both are sent the next time the app finds the server.

---

## Demo path 1 — browser on this machine

The everyday case, and the one that needs no configuration.

Three servers, three terminals:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

```bash
npm run dev:dashboard
```

Open `http://localhost:5173` for the training app. Served from port 5173, the
frontend calls port 3000 on the same host automatically — there is nothing to set.

`http://localhost:5174` redirects to the `/mobile/` Training Portal demo, **not**
the admin compliance dashboard — see [Dashboard](#dashboard).

## Demo path 2 — phone browser over Wi-Fi

Good for checking layout, translations, sync and certificates on a real handset.
**It cannot demo AR** — see the limitation below.

Find your machine's LAN address (`ipconfig` on Windows, `ifconfig` or `ip addr`
elsewhere), then on the phone open:

```
http://192.168.1.50:5173/?api=http://192.168.1.50:3000
```

`192.168.1.50` is an RFC1918 example — substitute your own address. The `?api=`
value is remembered, so later loads do not need it.

The backend must be told to accept that origin. Append it to the **existing**
`ALLOWED_ORIGINS` line in `.env` — the environment value replaces the built-in
list rather than adding to it, so keep every entry that is already there:

```
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost,https://localhost,capacitor://localhost,http://192.168.1.50:5173
```

Restart the backend afterwards. Both dev servers already listen on every network
interface, so no extra flag is needed, though a desktop firewall may ask you to
allow ports 3000 and 5173 the first time.

> **Limitation: no camera, so no AR.** Browsers only grant camera access on a
> secure origin, and a plain-HTTP LAN address is not one. `localhost` is trusted,
> a LAN IP is not. The app detects this and shows its unsupported-device view
> instead of failing messily, and everything that is not AR still works. **To demo
> AR on a phone, build the APK** — path 3, where the WebView origin is
> `http://localhost` and the camera is available.

## Demo path 3 — phone, as an APK

Meant to be the full demo, AR included. **Untested:** no APK has been built
yet, and AR will not get the camera until `android.permission.CAMERA` is added to
the generated `android/app/src/main/AndroidManifest.xml` — see
[Android / APK](#android--apk).

First, point the app at your backend. An installed app has no backend of its own,
and `localhost` on the phone means the phone. Edit `frontend/config.js`:

```js
window.SAFEAR_API_BASE = "http://192.168.1.50:3000";
```

Again an RFC1918 example — use your own address, and **do not commit it**. The
file ships with an empty default for exactly that reason. It holds an address,
not a credential; no key or token belongs in it.

Then build, from the project root:

```bash
npx cap add android
npx cap sync android
npx cap open android
```

`cap add android` generates the Android project and runs once per clone;
`cap sync android` copies `frontend/` into it and must run again after every
frontend change. The generated project is not committed — see `android/README.md`.

Two things are already configured for you:

- **CORS.** The Android WebView's origin is `http://localhost`, which is in the
  default `ALLOWED_ORIGINS`. Unlike path 2, no `.env` change is needed.
- **Cleartext HTTP.** Android has blocked plain HTTP by default since API 28, so
  the app could not reach `http://192.168.1.50:3000` at all. `capacitor.config.json`
  sets `server.cleartext: true` to permit it.

`cleartext` is a **demo-only setting**. It allows unencrypted traffic app-wide,
which is fine for a laptop backend on a closed Wi-Fi network and wrong for
anything real. A production build would serve the API over HTTPS and remove it.


## Team

From `REQUIREMENTS.md` — **not re-confirmed; the team should update this**
(git history also shows commits from contributors outside this list, and the
12 Sep build-sequence notes mention six people):

| Person | Owns |
|---|---|
| **Krish** | AR layer — `selectArTier`, Tier 1 WebXR, Tier 2 AR.js, in-AR interaction hooks |
| **Krishna** | Backend — Express API, SQLite, cert signing/verification, sync |
| **Kaamil** | Content & assessment — module scripts, checkpoints, Hindi + Santali audio, locales |
| **Sanyam** | Dashboard + packaging — admin dashboard, Capacitor APK, service worker |

Build rules for everyone: `AGENTS.md`.
