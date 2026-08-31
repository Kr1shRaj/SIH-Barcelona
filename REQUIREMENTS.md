# SafeAR — Requirements

## Deliverable (per hackathon brief)

- Working Android APK
- At least 2 complete AR training modules
- Assessment engine
- QR-based certificate generation and verification
- Hindi and Santali localization
- Offline functionality
- Web admin compliance dashboard
- Demo video + public GitHub repo

## Functional requirements

### AR training modules
- FR1: App detects device AR capability at startup and selects Tier 1
  (WebXR) or Tier 2 (AR.js marker) automatically
- FR2: Fire & Explosion Response module — exit identification, extinguisher
  use (aim/sweep interaction), evacuation sequencing
- FR3: Gas Leak & Confined Space module — hazard zone recognition, PPE
  selection, buddy-system procedure
- FR4: Each module includes pre-recorded Hindi and Santali audio narration
  synced to module steps
- FR5: In-AR scenario interactions (not a separate quiz screen) trigger
  assessment questions at defined checkpoints

### Assessment engine
- FR6: Score computed and stored locally as the user progresses
- FR7: Attempt log (module, question, answer, timestamp) stored locally,
  synced to backend when online
- FR8: Passing threshold configurable per module

### Certification
- FR9: On passing a module, generate a certificate record (worker ID,
  module, score, timestamp)
- FR10: Certificate is hashed and signed (HMAC); signed payload encoded
  into a QR code
- FR11: QR can be verified offline (signature re-check) and online
  (backend source-of-truth lookup)
- FR12: Tampered/invalid QR is explicitly rejected with a clear message

### Offline
- FR13: Module content (3D/marker assets, audio, scripts) downloaded once,
  cached locally
- FR14: App fully usable offline except cert sync and dashboard data refresh
- FR15: Sync resumes automatically when connectivity returns

### Admin dashboard
- FR16: List of certified workers, per-module completion rates
- FR17: Per-mine/per-contractor compliance status
- FR18: Expiring certifications flagged (periodic re-certification, per
  Mines Act)

## Non-functional requirements

- NFR1: Must install and run on Android 10+, including budget devices
  (₹8,000–12,000 range) that fail ARCore certification
- NFR2: UI is audio/icon-first, not text-dependent, given low literacy
  among target users
- NFR3: No dynamic TTS/ASR for Santali — pre-recorded audio only
- NFR4: No secrets committed to the repo — `.env` only
- NFR5: Cert signing scheme must be documented clearly enough that a judge
  can understand how tamper-detection works without reading the source

## Out of scope for this build

- Machinery safety module (3rd domain from the brief) — flagged as future
  work, not built
- Full 3D-modeled AR scenes — using AR.js marker content + WebXR where
  available, not custom Unity assets
- Dynamic/synthetic Santali speech

## Team split

| Person | Owns |
|---|---|
| **Krish** | AR layer — tier detection (`selectArTier`), Tier 1 WebXR wiring, Tier 2 AR.js marker wiring, in-AR interaction hooks for both modules |
| **Krishna** | Backend — Express API, SQLite schema, cert signing/verification service, offline sync endpoints |
| **Kaamil** | Content & assessment — module scripts (both modules), in-AR MCQ/checkpoint logic, Hindi + Santali audio recording/integration, locale JSON files |
| **Sanyam** | Dashboard + packaging — admin compliance dashboard (web), Capacitor APK build/config, service-worker/offline caching for the frontend |

Cross-cutting: cert-signing scheme (Krishna + Kaamil should agree on the
payload fields before FR9–FR12 are built, since content and backend both
touch the certificate record).

## Open questions (resolve before building)

- Exact passing threshold per module?
- Where do printed AR markers get displayed/distributed for Tier 2 (poster
  at training site vs. something workers carry)?
- Backend hosting for the demo (local/ngrok vs. deployed)?
