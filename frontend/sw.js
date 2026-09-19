// SafeAR Service Worker — Offline Training & Audio Cache
// Enables full AR training and audio playback in connectivity-deprived underground mines

// bump this whenever STATIC_ASSETS changes, or installed phones keep the old list
const CACHE_NAME = "safear-offline-v26";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/prerequisite.css",
  // 3D GLTF models for offline AR scenario rendering
  "./assets/models/animated_fire.glb",
  "./assets/models/fire_extinguisher.glb",
  "./assets/models/low_poly_green_running_man_exit_sign.glb",
  "./assets/models/notifier_rsg_t-bar_fire_alarm_pull_station.glb",
  // the whole ar runtime, vendored so a mine with no signal still renders scenes
  "./vendor/aframe.min.js",
  "./vendor/aframe-ar.js",
  // marker tracking reads these three at startup. without them tier 2 never boots.
  "./vendor/arjs-data/camera_para.dat",
  "./vendor/arjs-data/pattern-hiro.patt",
  "./vendor/arjs-data/pattern-kanji.patt",
  "./js/app.js",
  "./js/logger.js",
  "./js/i18n.js",
  "./js/audio.js",
  "./js/module-loader.js",
  "./js/api.js",
  "./js/certificates.js",
  "./js/certificate-panel.js",
  "./ar/tier.js",
  "./ar/webxr.js",
  "./ar/webxr_render.js",
  "./ar/marker.js",
  "./ar/interactions.js",
  "./ar/alignment.js",
  "./assessment/engine.js",
  // the pre-ar flow: language, equipment familiarization, module choice.
  // a worker meets all three before the camera ever opens, so they must be on the phone.
  "./screens/router.js",
  "./screens/language.js",
  "./screens/splash.js",
  "./assets/brand/safear-logo.png",
  "./screens/modules.js",
  "./prerequisite/equipment-data.js",
  "./prerequisite/equipment-art.js",
  "./prerequisite/progress.js",
  "./prerequisite/narration.js",
  "./prerequisite/translation-status.js",
  "./prerequisite/screen.js",
  "./prerequisite/detail.js",
  // the equipment photograph. a worker underground has to see it, so it ships
  // on the phone rather than being fetched when the card is opened.
  "./assets/images/fire-extinguisher.jpeg",
  // component close-ups for the exploded view. each is a real photograph of that
  // part, so a worker underground sees the thing itself, not a drawing of it.
  "./assets/images/fire-extinguisher-valve-kit.jpg",
  "./assets/images/fire-extinguisher-safety-pin.jpeg",
  "./assets/images/fire-extinguisher-hose.jpg",
  "./assets/images/fire-extinguisher-nozzle.jpg",
  // Each photograph's silhouette mask. Without it the photograph still renders, but
  // as the white studio rectangle it was shot on, so the two have to travel together
  // onto the phone or the screen looks broken underground.
  "./assets/images/fire-extinguisher.mask.png",
  "./assets/images/fire-extinguisher-valve-kit.mask.png",
  "./assets/images/fire-extinguisher-safety-pin.mask.png",
  "./assets/images/fire-extinguisher-hose.mask.png",
  "./assets/images/fire-extinguisher-nozzle.mask.png",
  // the gas leak / confined space set. one photograph per item carries both the
  // assembled view and every component cropped out of it, with its mask beside it.
  "./assets/images/gas-detector.jpg",
  "./assets/images/gas-detector.mask.png",
  "./assets/images/gas-scba.png",
  "./assets/images/gas-scba.mask.png",
  "./assets/images/gas-harness.jpg",
  "./assets/images/gas-harness.mask.png",
  "./assessment/observations.js",
  "./locales/en.json",
  "./locales/hi.json",
  "./locales/sat.json",
  "./modules/fire-response/fire-response.js",
  "./modules/fire-response/decision.js",
  "./modules/fire-response/graphics.js",
  "./modules/fire-response/webxr_fire_module.js",
  "./modules/fire-response/index.html",
  "./modules/gas-leak/gas-leak.js",
  "./modules/gas-leak/graphics.js",
  "./modules/gas-leak/index.html",
  // 3D models for gas leak and confined space module
  "./assets/models/gas-leak/caution_tapes.glb",
  "./assets/models/gas-leak/fog_indicator.glb",
  "./assets/models/gas-leak/h2s_detector.glb",
  "./assets/models/gas-leak/hazard_zone.glb",
  "./assets/models/gas-leak/safety_harness.glb",
  "./assets/models/gas-leak/scba_respirator.glb",
  "./assets/models/gas-leak/warning_sign.glb",
  // English narration audio clips
  "./audio/en/fire_response_step_1_exit.mp3",
  "./audio/en/fire_response_step_2_extinguisher.mp3",
  "./audio/en/fire_response_step_3_evacuate.mp3",
  "./audio/en/gas_leak_step_1_hazard.mp3",
  "./audio/en/gas_leak_step_2_ppe.mp3",
  "./audio/en/gas_leak_step_3_buddy.mp3",
  // Hindi narration audio clips
  "./audio/hi/fire_response_step_1_exit.mp3",
  "./audio/hi/fire_response_step_2_extinguisher.mp3",
  "./audio/hi/fire_response_step_3_evacuate.mp3",
  "./audio/hi/gas_leak_step_1_hazard.mp3",
  "./audio/hi/gas_leak_step_2_ppe.mp3",
  "./audio/hi/gas_leak_step_3_buddy.mp3",
  // Santali narration audio clips
  "./audio/sat/fire_response_step_1_exit.mp3",
  "./audio/sat/fire_response_step_2_extinguisher.mp3",
  "./audio/sat/fire_response_step_3_evacuate.mp3",
  "./audio/sat/gas_leak_step_1_hazard.mp3",
  "./audio/sat/gas_leak_step_2_ppe.mp3",
  "./audio/sat/gas_leak_step_3_buddy.mp3"
];

// cache core assets during install
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache each asset safely so one missing file does not fail entire installation
      await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            await cache.add(url);
          } catch (_err) {
            // ignore non-blocking fetch errors during offline build
          }
        })
      );
    })
  );
});

// clean up obsolete caches on activation
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
    }).then(() => self.clients.claim())
  );
});

// The app's own code, as opposed to the vendored runtime, the photographs and the
// audio. These are the files that change when the app changes.
//
// Everything used to be cache-first, which is right for a 1.9 MB AR runtime that
// never changes and wrong for the catalog that decides which equipment exists. A
// phone that had already installed the worker kept serving the equipment list it
// cached on first visit, so equipment added later simply never appeared — the new
// worker does not control the page load that discovers it, so the old files come
// back once more before it takes over. Two reloads, or nothing.
//
// These now go to the network first and fall back to the cache, so the app is never
// a version behind. Offline the fetch rejects at once and the cached copy answers,
// which is the behaviour a mine needs; the files are a few KB each.
function isAppCode(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path.includes("/vendor/")) return false;
  return path.endsWith("/")
    || path.endsWith(".html")
    || path.endsWith(".js")
    || path.endsWith(".css")
    || path.endsWith(".json");
}

// intercept network requests: fresh app code, cache-first for the heavy static assets
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. bypass service worker for backend /api/* routes
  // api sync and manifest caching is handled authoritatively by localStorage & engine
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 2. bypass non-GET requests
  if (req.method !== "GET") {
    return;
  }

  // 3. config.js carries the backend address for this install. cached, it would pin
  // a stale one and the app would keep calling a machine that has gone home. it is
  // deliberately absent from STATIC_ASSETS for the same reason.
  if (url.pathname.endsWith("/config.js")) {
    return;
  }

  // Every lookup below is scoped to THIS version's cache. caches.match() with no
  // cacheName searches every cache in the origin, so a stale one that outlived its
  // pruning could still answer — scoping it means a version bump cannot be
  // undermined by leftovers.
  const fromCache = (request) => caches.open(CACHE_NAME).then((cache) => cache.match(request));

  const store = (request, response) => {
    if (!response || response.status !== 200) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    return response;
  };

  // 4. the app's own code: newest wins, cache is the safety net
  if (isAppCode(url)) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => store(req, networkResponse))
        .catch(() => fromCache(req).then((cached) => {
          if (cached) return cached;
          // offline and never cached: a navigation still has to land somewhere
          return req.mode === "navigate" ? fromCache("./index.html") : null;
        }))
    );
    return;
  }

  // 5. everything else — the ar runtime, photographs, models, audio — is cache-first.
  // none of it changes without its filename or the cache version changing.
  event.respondWith(
    fromCache(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(req)
        .then((networkResponse) => store(req, networkResponse))
        .catch(() => {
          if (req.mode === "navigate") {
            return fromCache("./index.html");
          }
          return null;
        });
    })
  );
});
