# Equipment Narration — Recording Manifest

SafeAR is audio-first: the workers it is built for may not read the screen. Every
string in the equipment familiarization step therefore needs a recorded human voice,
one clip per equipment item per language.

**None of these 12 files exist yet.** Nothing in the app fabricates them. The
listen control stays visibly disabled until a real file is dropped at the exact path
below, and no locale is ever given another locale's recording to stand in for it.

## How to add a recording

1. Record the item's name, then its purpose, then each key part in order. Keep it
   under about 45 seconds — it is a recognition aid, not a lesson.
2. Export as MP3, mono, 64 kbps is plenty.
3. Save it at the exact path in the table. The filename is not free-form: it is
   derived by `getAudioPath(locale, "equipment", equipmentId)` in `js/audio.js`.
4. Add the path to `STATIC_ASSETS` in `sw.js`, bump `CACHE_NAME`, and update
   `ASSET_GRAPH_FINGERPRINT` in `tests/service_worker.test.js`. Without this the
   clip will not be on the phone underground, which is where it is needed.
5. No UI code has to change. The screen probes for the file and enables itself.

## Do not

- Do not use text-to-speech for Santali. Ol Chiki TTS is not good enough, and
  `AGENTS.md` rules it out.
- Do not copy the English clip into `hi/` or `sat/`. A worker who picked Santali and
  hears English has been told the app speaks their language when it does not.
- Do not commit a silent or placeholder MP3 to make the button light up.

## Required files

### English — `frontend/audio/en/`

| Equipment | Narration key | Path | Script source | Status |
|---|---|---|---|---|
| Fire Extinguisher | `equipment_fire_extinguisher` | `frontend/audio/en/equipment_fire_extinguisher.mp3` | `equipment.fire_extinguisher.name` | NOT RECORDED |
| Multi-Gas Detector | `equipment_multi_gas_detector` | `frontend/audio/en/equipment_multi_gas_detector.mp3` | `equipment.multi_gas_detector.name` | NOT RECORDED |
| SCBA / Breathing Apparatus | `equipment_scba` | `frontend/audio/en/equipment_scba.mp3` | `equipment.scba.name` | NOT RECORDED |
| Safety Harness & Lifeline | `equipment_safety_harness` | `frontend/audio/en/equipment_safety_harness.mp3` | `equipment.safety_harness.name` | NOT RECORDED |

### Hindi (हिन्दी) — `frontend/audio/hi/`

| Equipment | Narration key | Path | Script source | Status |
|---|---|---|---|---|
| अग्निशामक यंत्र | `equipment_fire_extinguisher` | `frontend/audio/hi/equipment_fire_extinguisher.mp3` | `equipment.fire_extinguisher.name` | NOT RECORDED |
| मल्टी-गैस डिटेक्टर | `equipment_multi_gas_detector` | `frontend/audio/hi/equipment_multi_gas_detector.mp3` | `equipment.multi_gas_detector.name` | NOT RECORDED |
| एससीबीए / श्वास उपकरण | `equipment_scba` | `frontend/audio/hi/equipment_scba.mp3` | `equipment.scba.name` | NOT RECORDED |
| सुरक्षा हार्नेस और लाइफलाइन | `equipment_safety_harness` | `frontend/audio/hi/equipment_safety_harness.mp3` | `equipment.safety_harness.name` | NOT RECORDED |

### Santali (ᱥᱟᱱᱛᱟᱲᱤ) — `frontend/audio/sat/`

| Equipment | Narration key | Path | Script source | Status |
|---|---|---|---|---|
| Fire Extinguisher | `equipment_fire_extinguisher` | `frontend/audio/sat/equipment_fire_extinguisher.mp3` | awaiting translation | NOT RECORDED |
| Multi-Gas Detector | `equipment_multi_gas_detector` | `frontend/audio/sat/equipment_multi_gas_detector.mp3` | awaiting translation | NOT RECORDED |
| SCBA / Breathing Apparatus | `equipment_scba` | `frontend/audio/sat/equipment_scba.mp3` | awaiting translation | NOT RECORDED |
| Safety Harness & Lifeline | `equipment_safety_harness` | `frontend/audio/sat/equipment_safety_harness.mp3` | awaiting translation | NOT RECORDED |

## Blocked on translation

The 1 Santali clips cannot be recorded until the Santali script exists.
See `frontend/locales/SANTALI_TRANSLATION_MANIFEST.md`.
