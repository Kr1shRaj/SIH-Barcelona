# SafeAR

AR-based vocational safety training and certification platform for mining,
steel, and mica sector workers in Jharkhand — built for [hackathon name].

## Problem

Classroom-based safety training (static manuals) has under-20% retention after
a week. Live drills disrupt operations. VR headsets are inaccessible to small
mines and contract workers. Physical safety certificates have no way to verify
the holder actually understood the material. DGMS recorded 48 fatal mine
accidents in Jharkhand in 2022–23, many involving workers with under 30 days
of orientation.

## What this is

A mobile-first AR training app that runs on the mid-range Android phones
workers actually own (not headsets), teaches two safety modules through
in-AR interaction rather than static video, certifies comprehension with a
tamper-verifiable QR code, works offline, and is available in Hindi and
Santali.

## Modules (scope for this build)

1. **Fire & Explosion Response** — exit identification, extinguisher use,
   evacuation sequencing
2. **Gas Leak & Confined Space Protocol** — hazard zone recognition, PPE
   selection, buddy-system procedure

## Stack

- **Frontend:** HTML/CSS/JS + [AR.js](https://ar-js-org.github.io/AR.js-Docs/)
  for AR rendering, packaged as an installable Android APK via
  [Capacitor](https://capacitorjs.com/)
- **Backend:** Node.js + Express
- **Database:** SQLite (`better-sqlite3`) — local-first, syncs when online
- **Certs:** signed QR codes (Node `crypto` + `qrcode` package)
- **Localization:** static locale JSON (Hindi, Santali) + pre-recorded audio
  narration (no dynamic TTS — see `AGENTS.md` for why)

One language (JS) across the whole stack so all four of us can move between
frontend, backend, and AR without a separate native/Unity track.

## AR approach

Two tiers, chosen automatically per device — see `AGENTS.md` for the full
rationale and rules:

- **Tier 1:** WebXR device tracking, where the browser/device supports it
- **Tier 2 (fallback, most target devices):** AR.js marker-based tracking

## Project structure (planned)

```
safear/
├── AGENTS.md
├── README.md
├── REQUIREMENTS.md
├── backend/
│   ├── routes/
│   ├── services/
│   │   └── certs/          # signing/verification, isolated from Express
│   ├── models/              # request/response validation
│   └── tests/
├── frontend/
│   ├── modules/
│   │   ├── fire-response/
│   │   └── gas-leak/
│   ├── ar/                  # tier selection + AR.js/WebXR wiring
│   ├── locales/
│   │   ├── hi.json
│   │   └── sat.json
│   └── audio/                # per-module narration clips (hi/, sat/)
├── dashboard/                 # admin compliance dashboard
└── android/                   # Capacitor-generated APK project
```

## Running locally

### First-time setup

Do this once per clone. The backend refuses to start without a signing key and a
database, so skipping any of it fails immediately rather than subtly.

```bash
npm install
cp .env.example .env
npm run keygen --workspace=backend
```

`keygen` writes the public key to `backend/keys/cert-signing.public.pem` and prints
a `CERT_PRIVATE_KEY=...` line. Paste that line into `.env` and fill in the other
placeholder values while you are there.

**The two halves of the key are handled differently, and it matters:**

- The **private key** lives only in `.env`, which git ignores. It never goes into
  the repository, a chat message, or a screenshot. It is the only thing that can
  mint a certificate.
- The **public key** is not a secret, and the team shares one. Commit
  `backend/keys/cert-signing.public.pem` once, and everybody verifies against it.

If each teammate runs `keygen` and keeps their own pair, a certificate issued on
one laptop fails verification on another with `bad_signature`. For a demo across
two machines, one person generates the pair, commits the public half, and passes
the `CERT_PRIVATE_KEY` line to the others out of band. `keygen` refuses to
overwrite an existing public key for the same reason — rotating it orphans every
certificate already issued.

Then create the demo data — workers, modules and the checkpoint manifest:

```bash
npm run seed --workspace=backend
```

Without this the database has no workers, and every attempt sync comes back
`unknown_worker`.

### How the app finds the backend

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

Open `http://localhost:5173` for the training app and `http://localhost:5174` for
the admin dashboard. Served from port 5173, the frontend calls port 3000 on the
same host automatically — there is nothing to set.

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

The full demo, AR included.

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

## Status

Planning stage — see `REQUIREMENTS.md` for scope and `AGENTS.md` for build
rules before writing any code.


