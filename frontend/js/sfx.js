// synth sound cues + haptics. no asset files, web audio oscillators and noise only.
// every call is best effort: no audio api, blocked autoplay or no vibrator = silent no-op.
import { createSeededRandom } from "../ar/webxr_render.js";

let _ctx = null;

// fire bed level while nobody talks, and the share of it left under narration.
// narration is the main channel for santali workers, so the roar must never mask it
const FIRE_BED_GAIN = 0.35;
const NARRATION_DUCK = 0.25;

// one shared audio context, made on first cue
function _audio() {
  if (_ctx) return _ctx;
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    _ctx = new Ctor();
  } catch {
    _ctx = null;
  }
  return _ctx;
}

// buzz phone if it can, pattern same as navigator.vibrate
function vibrate(pattern) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

// play one short enveloped tone, freq may glide to endFreq
function playTone({ freq, endFreq = null, durMs = 80, startMs = 0, type = "sine", gain = 0.05 }) {
  const ctx = _audio();
  if (!ctx || typeof ctx.createOscillator !== "function") return false;
  try {
    if (ctx.state === "suspended" && typeof ctx.resume === "function") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + startMs / 1000;
    const t1 = t0 + durMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t1);
    // quick attack, quick release, no click
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
    return true;
  } catch {
    return false;
  }
}

// detector chirp pitch climb with gas reading (0-10 % vol)
function gasChirpFrequency(reading) {
  const r = Math.max(0, Math.min(10, Number(reading) || 0));
  return Math.round(520 + r * 110);
}

// three quick detector blips, faster and higher when gas high
function playGasChirp(reading) {
  const freq = gasChirpFrequency(reading);
  const gapMs = reading >= 5 ? 90 : 160;
  for (let i = 0; i < 3; i++) {
    playTone({ freq, durMs: 55, startMs: i * gapMs, type: "square", gain: 0.03 });
  }
}

// two-tone emergency siren, hi/lo swap every 250ms
function playSiren(durationMs = 1000) {
  const steps = Math.max(1, Math.round(durationMs / 250));
  for (let i = 0; i < steps; i++) {
    playTone({ freq: i % 2 === 0 ? 960 : 720, durMs: 240, startMs: i * 250, type: "sawtooth", gain: 0.035 });
  }
}

// tiny confirm blip for lock-on
function playLockBlip() {
  playTone({ freq: 880, endFreq: 1320, durMs: 90, type: "sine", gain: 0.04 });
}

// seconds of seeded white noise, or brown noise (integrated white: deep, rumbling)
function _noiseBuffer(ctx, seconds, seed, brown = false) {
  const rand = createSeededRandom(seed);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = rand() * 2 - 1;
    // leaky integrator keeps brown noise from drifting off, the gain brings it back to level
    last = brown ? (last + 0.02 * white) / 1.02 : white;
    data[i] = brown ? last * 3.5 : white;
  }
  return buf;
}

// one looping noise source through one filter into the bus
function _noiseVoice(ctx, buffer, bus, { type, freq, q = 0.7, gain }) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  src.connect(filter);
  filter.connect(amp);
  amp.connect(bus);
  src.start();
  return { src, amp };
}

// fire bed: deep brown-noise roar, crackle pops through a bandpass, a thin wind hiss.
// no files. intensity follows the flames; narration ducks it to a quarter. null when no audio api
function startFireAudio({ seed = 0x5afea2 } = {}) {
  const ctx = _audio();
  if (!ctx || typeof ctx.createBuffer !== "function" || typeof ctx.createBiquadFilter !== "function") return null;
  try {
    if (ctx.state === "suspended" && typeof ctx.resume === "function") ctx.resume().catch(() => {});
    const rand = createSeededRandom(seed);
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(ctx.destination);

    const white = _noiseBuffer(ctx, 2, seed);
    const brown = _noiseBuffer(ctx, 2, seed + 1, true);
    const voices = [
      _noiseVoice(ctx, brown, bus, { type: "lowpass", freq: 320, gain: 0.9 }),
      _noiseVoice(ctx, white, bus, { type: "highpass", freq: 2500, q: 0.5, gain: 0.05 })
    ];
    const crackle = _noiseVoice(ctx, white, bus, { type: "bandpass", freq: 2800, q: 1.2, gain: 0 });
    voices.push(crackle);

    let intensity = 1;
    let ducked = false;
    let stopped = false;
    const applyLevel = () => {
      const target = Math.max(0.0001, FIRE_BED_GAIN * intensity * (ducked ? NARRATION_DUCK : 1));
      bus.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
    };

    // seeded pops scheduled a little ahead: louder and denser while the fire is big
    const schedulePops = () => {
      const now = ctx.currentTime;
      const pops = Math.round(2 + rand() * 4 * intensity);
      const times = Array.from({ length: pops }, () => now + rand() * 0.25).sort((x, y) => x - y);
      times.forEach((t0) => {
        crackle.amp.gain.setValueAtTime(0.25 + rand() * 0.6 * intensity, t0);
        crackle.amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02 + rand() * 0.05);
      });
    };
    const popTimer = setInterval(schedulePops, 250);

    const onNarration = (ev) => {
      ducked = Boolean(ev && ev.detail && ev.detail.playing);
      applyLevel();
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("safear:narration", onNarration);
    }
    applyLevel();

    return {
      // 0 = out, 1 = full blaze
      setIntensity(k) {
        if (stopped) return;
        intensity = Math.max(0, Math.min(1, Number(k) || 0));
        applyLevel();
      },
      isDucked: () => ducked,
      // fade out over half a second, then free everything
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(popTimer);
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          window.removeEventListener("safear:narration", onNarration);
        }
        bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
        voices.forEach((v) => {
          try { v.src.stop(ctx.currentTime + 0.6); } catch { /* already stopped */ }
        });
      }
    };
  } catch {
    return null;
  }
}

export { vibrate, playTone, playGasChirp, playSiren, playLockBlip, gasChirpFrequency, startFireAudio, FIRE_BED_GAIN, NARRATION_DUCK };
