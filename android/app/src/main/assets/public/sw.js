// SafeAR Service Worker — Offline Training & Audio Cache
// Enables full AR training and audio playback in connectivity-deprived underground mines

const CACHE_NAME = "safear-offline-v1";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/logger.js",
  "./js/i18n.js",
  "./js/audio.js",
  "./js/module-loader.js",
  "./ar/tier.js",
  "./ar/webxr.js",
  "./ar/marker.js",
  "./ar/interactions.js",
  "./assessment/engine.js",
  "./locales/en.json",
  "./locales/hi.json",
  "./locales/sat.json",
  "./modules/fire-response/fire-response.js",
  "./modules/fire-response/graphics.js",
  "./modules/fire-response/index.html",
  "./modules/gas-leak/gas-leak.js",
  "./modules/gas-leak/graphics.js",
  "./modules/gas-leak/index.html",
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

// intercept network requests: cache-first for static assets, network-only for api
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

  // 3. Cache-first strategy for local assets and external libraries
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(req).then((networkResponse) => {
        // cache valid responses for later offline use
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // if offline and requesting navigation, serve index.html
        if (req.mode === "navigate") {
          return caches.match("./index.html");
        }
        return null;
      });
    })
  );
});
