// Procedurally-generated ambient sound library — no audio files, no downloads,
// no licensing to track. Every sound is synthesized on the fly with the Web
// Audio API from a short buffer of colored noise, looped seamlessly.
//
// Choice of sounds follows the research on background sound and reading
// (see /Downloads/sound.md brought into this project): plain noise (white/
// pink/brown) is null-to-mildly-positive for focus and specifically helps
// some ADHD/dyslexic readers; low-semantic ambient sound supports attention
// without the comprehension cost that speech or lyrics carry. Deliberately
// no music and no vocal/speech tracks — the evidence is that those hurt
// reading comprehension. The environment presets (forest, café, library,
// fireplace, night) are the same colored-noise base as rain/ocean/wind, with
// a handful of scattered one-off transients layered in (birdsong, porcelain
// clink, page rustle, wood crackle, cricket chirps) so each reads as a place
// rather than just a texture, while staying just as free of language/melody.

export const SOUND_GROUPS = [
  {
    id: 'noise',
    label: 'noise',
    sounds: [
      { id: 'white', label: 'White', icon: '○', build: buildWhite },
      { id: 'pink', label: 'Pink', icon: '◐', build: buildPink },
      { id: 'brown', label: 'Brown', icon: '●', build: buildBrown },
    ],
  },
  {
    id: 'ambience',
    label: 'ambience',
    sounds: [
      { id: 'rain', label: 'Rain', icon: '🌧', build: buildRain },
      { id: 'ocean', label: 'Ocean', icon: '🌊', build: buildOcean },
      { id: 'wind', label: 'Wind', icon: '🍃', build: buildWind },
      { id: 'forest', label: 'Forest', icon: '🌲', build: buildForest },
      { id: 'cafe', label: 'Café', icon: '☕', build: buildCafe },
      { id: 'library', label: 'Library', icon: '📖', build: buildLibrary },
      { id: 'fireplace', label: 'Fireplace', icon: '🔥', build: buildFireplace },
      { id: 'night', label: 'Night', icon: '🌙', build: buildNight },
    ],
  },
];

export const SOUND_DEFS = SOUND_GROUPS.flatMap(g => g.sounds);

// ---------- noise-color generators (operate on plain Float32Array) ----------

function whiteSamples(len) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.random() * 2 - 1;
  return out;
}

function pinkFilter(white) {
  const out = new Float32Array(white.length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < white.length; i++) {
    const w = white[i];
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

function brownFilter(white) {
  const out = new Float32Array(white.length);
  let last = 0;
  let maxAbs = 0;
  for (let i = 0; i < white.length; i++) {
    last = (last + 0.02 * white[i]) / 1.02;
    out[i] = last;
    const a = Math.abs(last);
    if (a > maxAbs) maxAbs = a;
  }
  const norm = maxAbs > 0 ? 0.9 / maxAbs : 1;
  for (let i = 0; i < out.length; i++) out[i] *= norm;
  return out;
}

function brighten(pink, white, mix) {
  const out = new Float32Array(pink.length);
  for (let i = 0; i < pink.length; i++) out[i] = pink[i] * (1 - mix) + white[i] * mix;
  return out;
}

function dullen(samples, alpha) {
  const out = new Float32Array(samples.length);
  let prev = 0;
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    prev += alpha * (samples[i] - prev);
    out[i] = prev;
    const a = Math.abs(prev);
    if (a > maxAbs) maxAbs = a;
  }
  const norm = maxAbs > 0 ? 0.9 / maxAbs : 1;
  for (let i = 0; i < out.length; i++) out[i] *= norm;
  return out;
}

// A sine-sum envelope whose every component period evenly divides `duration`,
// so it loops with zero seam regardless of buffer length.
function envelopeAt(t, components) {
  let v = 0;
  for (const [period, weight, phase] of components) {
    v += weight * Math.sin((2 * Math.PI * t) / period + (phase || 0));
  }
  return v;
}

// ---------- one-off transient events (bird chirps, crackles, page rustle...) ----------
// Scattered directly into the colored buffer before the loop-point crossfade,
// so a slow amplitude envelope (if any) still sweeps them naturally. Kept out
// of the final `fadeSeconds` window so a transient never gets split/dulled by
// the crossfade blend at the loop seam.

function addTone(out, sr, safeLen, tSec, durMs, freq, amp, sweep = 0) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor((durMs / 1000) * sr);
  if (start < 0 || start + len >= safeLen) return;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    const env = Math.sin(Math.PI * x); // 0 at both ends, smooth in/out
    const f = freq + sweep * x;
    out[start + i] += Math.sin(2 * Math.PI * f * (i / sr)) * amp * env;
  }
}

function addNoiseBurst(out, sr, safeLen, tSec, durMs, amp, decayPow = 6) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor((durMs / 1000) * sr);
  if (start < 0 || start + len >= safeLen) return;
  for (let i = 0; i < len; i++) {
    const decay = Math.exp((-decayPow * i) / len);
    out[start + i] += (Math.random() * 2 - 1) * amp * decay;
  }
}

// Scatters `count` events across [0, safeLen) with irregular (poisson-ish)
// spacing rather than a metronomic regular one, calling `place(tSec)` for each.
function scatterEvents(sr, safeLen, avgGapSec, jitter, place) {
  const totalSec = safeLen / sr;
  let t = avgGapSec * Math.random();
  while (t < totalSec) {
    place(t);
    t += avgGapSec * (1 - jitter + Math.random() * jitter * 2);
  }
}

// ---------- buffer assembly ----------

function buildBuffer(ctx, seconds, colorFn, envelopeComponents, base = 1, fadeSeconds = 0.35, transientFn) {
  const sr = ctx.sampleRate;
  const mainLen = Math.floor(sr * seconds);
  const fadeLen = Math.floor(sr * fadeSeconds);
  const totalLen = mainLen + fadeLen;
  const white = whiteSamples(totalLen);
  const colored = colorFn(white);

  if (transientFn) transientFn(colored, sr, mainLen - fadeLen);

  // crossfade the tail (generated with the same running filter state, so it
  // continues naturally) back into the head — makes the loop point inaudible
  for (let i = 0; i < fadeLen; i++) {
    const m = i / fadeLen;
    colored[i] = colored[i] * m + colored[mainLen + i] * (1 - m);
  }
  const final = colored.subarray(0, mainLen);

  if (envelopeComponents) {
    for (let i = 0; i < mainLen; i++) {
      const t = i / sr;
      final[i] *= clamp(base + envelopeAt(t, envelopeComponents), 0.05, 1.4);
    }
  }

  const buffer = ctx.createBuffer(1, mainLen, sr);
  buffer.copyToChannel(Float32Array.from(final), 0);
  return buffer;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function buildWhite(ctx) { return buildBuffer(ctx, 6, (w) => w.slice()); }
function buildPink(ctx) { return buildBuffer(ctx, 6, pinkFilter); }
function buildBrown(ctx) { return buildBuffer(ctx, 6, brownFilter); }

function buildRain(ctx) {
  return buildBuffer(
    ctx, 10,
    (w) => brighten(pinkFilter(w), w, 0.18),
    [[10 / 7, 0.16, 0], [10 / 11, 0.14, 1.3]],
    0.72
  );
}

function buildOcean(ctx) {
  return buildBuffer(
    ctx, 10,
    brownFilter,
    [[5, 0.42, -Math.PI / 2]],
    0.55
  );
}

function buildWind(ctx) {
  return buildBuffer(
    ctx, 10,
    (w) => dullen(pinkFilter(w), 0.08),
    [[10 / 3, 0.4, 0]],
    0.55
  );
}

function buildForest(ctx) {
  return buildBuffer(
    ctx, 16,
    (w) => dullen(pinkFilter(w), 0.15),
    [[16 / 5, 0.22, 0]],
    0.4,
    0.35,
    (out, sr, safeLen) => {
      // birdsong: short upward-swept chirps at irregular intervals, a couple
      // of species (pitch families) so it doesn't read as one repeating loop
      scatterEvents(sr, safeLen, 2.6, 0.8, (t) => {
        const high = Math.random() > 0.5;
        addTone(out, sr, safeLen, t, high ? 90 : 140, high ? 3200 : 2200, 0.05, high ? 900 : 500);
        if (Math.random() > 0.6) addTone(out, sr, safeLen, t + 0.12, 70, (high ? 3400 : 2400) - 300, 0.035, high ? -600 : -300);
      });
      // occasional leaf-rustle burst, softer/broader than a bird chirp
      scatterEvents(sr, safeLen, 5.5, 0.7, (t) => addNoiseBurst(out, sr, safeLen, t, 260, 0.05, 3));
    }
  );
}

function buildCafe(ctx) {
  return buildBuffer(
    ctx, 14,
    (w) => dullen(brighten(pinkFilter(w), w, 0.08), 0.03),
    [[14 / 5, 0.18, 0.6]],
    0.6,
    0.35,
    (out, sr, safeLen) => {
      // porcelain clink — a bright, fast-decaying tone pair
      scatterEvents(sr, safeLen, 4.2, 0.75, (t) => {
        addTone(out, sr, safeLen, t, 45, 2800 + Math.random() * 900, 0.045);
        addTone(out, sr, safeLen, t + 0.03, 60, 1800 + Math.random() * 500, 0.03);
      });
      // low, soft chair/footstep thump — rare
      scatterEvents(sr, safeLen, 9, 0.6, (t) => addNoiseBurst(out, sr, safeLen, t, 90, 0.06, 8));
    }
  );
}

function buildLibrary(ctx) {
  return buildBuffer(
    ctx, 18,
    (w) => dullen(brownFilter(w), 0.02),
    [[18 / 7, 0.08, 0]],
    0.22,
    0.4,
    (out, sr, safeLen) => {
      // a page turn: a soft, fairly long noise swell — much gentler attack
      // than the cafe clink or fireplace crackle, and rare
      scatterEvents(sr, safeLen, 8, 0.6, (t) => addNoiseBurst(out, sr, safeLen, t, 220, 0.035, 2.2));
    }
  );
}

function buildFireplace(ctx) {
  return buildBuffer(
    ctx, 12,
    (w) => dullen(brownFilter(w), 0.05),
    [[12 / 4, 0.3, -1]],
    0.5,
    0.35,
    (out, sr, safeLen) => {
      // wood crackle/pop — short sharp noise bursts, frequent and irregular
      scatterEvents(sr, safeLen, 0.55, 0.9, (t) => {
        addNoiseBurst(out, sr, safeLen, t, 12 + Math.random() * 20, 0.09 + Math.random() * 0.08, 10);
      });
    }
  );
}

function buildNight(ctx) {
  return buildBuffer(
    ctx, 16,
    (w) => dullen(brownFilter(w), 0.04),
    [[16 / 6, 0.15, 0]],
    0.28,
    0.4,
    (out, sr, safeLen) => {
      // crickets: a rapid little burst of identical pulses per "chirp"
      scatterEvents(sr, safeLen, 1.8, 0.5, (t) => {
        const pulses = 3 + Math.floor(Math.random() * 3);
        for (let p = 0; p < pulses; p++) {
          addTone(out, sr, safeLen, t + p * 0.045, 18, 2600 + Math.random() * 200, 0.03);
        }
      });
    }
  );
}

// ---------- engine ----------

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.source = null;
    this.currentId = null;
    this.bufferCache = new Map();
    this.volume = 0.45;
  }

  ensureCtx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  getBuffer(id) {
    if (this.bufferCache.has(id)) return this.bufferCache.get(id);
    const def = SOUND_DEFS.find((d) => d.id === id);
    if (!def) return null;
    const buf = def.build(this.ctx);
    this.bufferCache.set(id, buf);
    return buf;
  }

  play(id) {
    const ctx = this.ensureCtx();
    this.stop();
    const buffer = this.getBuffer(id);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.masterGain);
    source.start();
    this.source = source;
    this.currentId = id;
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    this.currentId = null;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }
}

export const soundEngine = new SoundEngine();
