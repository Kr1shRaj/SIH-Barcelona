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

## Status

Planning stage — see `REQUIREMENTS.md` for scope and `AGENTS.md` for build
rules before writing any code.

