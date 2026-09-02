import { getLocale } from "./i18n.js";
import { createLogger } from "./logger.js";

const logger = createLogger("AudioNarration");

let _currentAudio = null;
let _currentStatus = {
  playing: false,
  locale: null,
  moduleId: null,
  stepKey: null,
  src: null
};

// construct deterministic path for prerecorded audio clip
function getAudioPath(locale, moduleId, stepKey, basePath = "./audio") {
  const resolvedLocale = locale || getLocale() || "hi";
  const cleanModule = (moduleId || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
  const cleanStep = (stepKey || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${basePath}/${resolvedLocale}/${cleanModule}_${cleanStep}.mp3`;
}

// get current audio narration state
function getAudioStatus() {
  return { ..._currentStatus };
}

// stop active audio narration playback
function stopNarration() {
  if (_currentAudio) {
    try {
      if (typeof _currentAudio.pause === "function") {
        _currentAudio.pause();
      }
      _currentAudio.currentTime = 0;
    } catch (_err) {
      // ignore pause errors in non browser env
    }
    _currentAudio = null;
  }
  _currentStatus = {
    playing: false,
    locale: null,
    moduleId: null,
    stepKey: null,
    src: null
  };
}

// play prerecorded narration clip with fallback handling
function playNarration({ locale, moduleId, stepKey, basePath = "./audio", onEnded, onError } = {}) {
  stopNarration();

  if (!moduleId || !stepKey) {
    logger.warn({ event: "audio_play_missing_args", moduleId, stepKey }, "Cannot play audio without moduleId and stepKey");
    return { success: false, reason: "missing_args" };
  }

  const resolvedLocale = locale || getLocale() || "hi";
  const path = getAudioPath(resolvedLocale, moduleId, stepKey, basePath);

  _currentStatus = {
    playing: true,
    locale: resolvedLocale,
    moduleId,
    stepKey,
    src: path
  };

  logger.info({ event: "audio_narration_start", path, locale: resolvedLocale, moduleId, stepKey }, "Playing narration");

  const AudioConstructor = (typeof window !== "undefined" && typeof window.Audio === "function")
    ? window.Audio
    : (typeof globalThis !== "undefined" && typeof globalThis.Audio === "function" ? globalThis.Audio : null);

  if (AudioConstructor) {
    try {
      const audio = new AudioConstructor(path);
      _currentAudio = audio;

      audio.addEventListener("ended", () => {
        _currentStatus.playing = false;
        if (typeof onEnded === "function") onEnded();
      });

      audio.addEventListener("error", (err) => {
        logger.warn({ event: "audio_asset_unavailable", path, error: err }, "Prerecorded audio asset unavailable");
        _currentStatus.playing = false;
        if (typeof onError === "function") onError(err);
      });

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => {
          logger.warn({ event: "audio_play_prevented", path, error: err.message }, "Audio playback prevented");
          _currentStatus.playing = false;
          if (typeof onError === "function") onError(err);
        });
      }
    } catch (err) {
      logger.warn({ event: "audio_init_error", path, error: err.message }, "Audio constructor failed");
      _currentStatus.playing = false;
      if (typeof onError === "function") onError(err);
      return { success: false, path, reason: "audio_init_failed" };
    }
  }

  return { success: true, path, status: { ..._currentStatus } };
}

// reset audio module state for testing
function resetAudioState() {
  stopNarration();
}

export {
  getAudioPath,
  getAudioStatus,
  playNarration,
  stopNarration,
  resetAudioState
};
