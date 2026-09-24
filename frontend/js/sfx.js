// synth sound cues + haptics. no asset files, web audio oscillators only.
// every call is best effort: no audio api, blocked autoplay or no vibrator = silent no-op.

let _ctx = null;

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

export { vibrate, playTone, playGasChirp, playSiren, playLockBlip, gasChirpFrequency };
