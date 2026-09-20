// The loading screen: what SafeAR shows while it is coming up.
//
// It is deliberately NOT part of the router's flow. SCREEN_ORDER is the sequence a
// worker walks — language, equipment, module, training — and the loading screen is
// not a step in it. It is what the app looks like before the first of those steps is
// ready, so it mounts onto the container itself and hands over to whichever screen
// the flow starts on.
//
// Everything here is presentation. It gates nothing, decides nothing, and the app
// behaves exactly the same if the timers never fire.

import { t } from "../js/i18n.js";
import { createLogger } from "../js/logger.js";

const logger = createLogger("Splash");

// The supplied logo, trimmed to its own ink so the clear space around it is set by
// the stylesheet and is the same everywhere. The untouched original sits next to it
// as safear-logo-source.png — see assets/brand/README.md.
const BRAND_LOGO = "./assets/brand/safear-logo.png";

// The logo's real proportions. Written onto the img so the browser reserves the
// right box before the file arrives and the screen does not jump.
const BRAND_LOGO_SIZE = { width: 471, height: 112 };

// How long the screen stays up. Long enough to read the tagline, short enough that
// nobody waits: the entrance runs, the progress bar crosses, and it leaves.
const SPLASH_HOLD_MS = 2400;
const SPLASH_EXIT_MS = 280;

// A worker who has asked for less movement is not asking to be kept waiting while
// nothing moves, so the hold is cut to about a third and nothing animates.
const SPLASH_REDUCED_MS = 900;

function _esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// what the two timers are for this run
function splashTimings(reduced = false) {
  return reduced
    ? { hold: SPLASH_REDUCED_MS, exit: 0 }
    : { hold: SPLASH_HOLD_MS, exit: SPLASH_EXIT_MS };
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (err) {
    return false;
  }
}

// The screen itself. The logo sits on its own white plate because the logo IS drawn
// on white — navy letterforms, no transparency — and the product's ground is
// graphite. Rather than recolour the mark or key its background out and leave a
// halo around every letter, the plate gives it the surface it was drawn for. It
// reads as the nameplate on a piece of equipment, which is the right note anyway.
function renderSplashHtml() {
  const name = _esc(t("app.title", {}, "SafeAR"));
  const tagline = _esc(t("app.tagline", {}, "Ready before it is real."));
  const status = _esc(t("app.splash_loading", {}, "Preparing your training environment"));

  return `
    <section class="splash" data-role="splash">
      <div class="splash__stack">
        <div class="splash__plate">
          <img class="splash__logo" src="${_esc(BRAND_LOGO)}" alt="${name}"
            width="${BRAND_LOGO_SIZE.width}" height="${BRAND_LOGO_SIZE.height}" decoding="async" />
        </div>
        <p class="splash__tagline">${tagline}</p>
      </div>

      <div class="splash__foot">
        <div class="splash__track" data-role="splash-track">
          <div class="splash__fill" data-role="splash-fill"></div>
        </div>
        <p class="splash__status" role="status">${status}<span class="splash__dots" aria-hidden="true">…</span></p>
      </div>
    </section>
  `;
}

// Put it up, then take it down and call on.
//
// `onDone` is what actually starts the app's first screen, so it runs exactly once
// whatever happens — including when the timers are missing, which is what the node
// tests see.
function mountSplashScreen({ container, onDone, reduced = prefersReducedMotion() } = {}) {
  if (!container) return null;

  const finish = (() => {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      if (typeof onDone === "function") onDone();
    };
  })();

  container.innerHTML = renderSplashHtml();
  const screen = container.querySelector ? container.querySelector('[data-role="splash"]') : null;
  const timings = splashTimings(reduced);

  logger.info({ event: "splash_shown", reduced, hold: timings.hold }, "Loading screen shown");

  const timers = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window : null;
  if (!timers) {
    finish();
    return { finish };
  }

  // the entrance is a class rather than a keyframe, so the same rule that fades the
  // screen in is the one reduced motion switches off
  if (screen && !reduced && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => screen.classList.add("splash--in"));
    });
  } else if (screen) {
    screen.classList.add("splash--in");
  }

  const leave = timers.setTimeout(() => {
    if (screen && !reduced) {
      screen.classList.add("splash--out");
      timers.setTimeout(finish, timings.exit);
      return;
    }
    finish();
  }, timings.hold);

  return {
    finish,
    // a caller that wants the app now rather than in two seconds
    skip: () => {
      timers.clearTimeout(leave);
      finish();
    }
  };
}

export {
  BRAND_LOGO,
  BRAND_LOGO_SIZE,
  SPLASH_HOLD_MS,
  SPLASH_EXIT_MS,
  SPLASH_REDUCED_MS,
  splashTimings,
  renderSplashHtml,
  mountSplashScreen
};
