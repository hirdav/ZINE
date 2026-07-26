// Procedurally-generated ambient sound library — no audio files, no downloads,
// no licensing to track. Every sound is synthesized on the fly with the Web
// Audio API from a short buffer of colored noise, looped seamlessly.
//
// Choice of sounds follows the research on background sound and reading
// (see /Downloads/sound.md brought into this project): plain noise (white/
// pink/brown) is null-to-mildly-positive for focus and specifically helps
// some ADHD/dyslexic readers; low-semantic nature sound supports attention
// without the comprehension cost that speech or lyrics carry. Deliberately
// no music and no vocal/speech tracks — the evidence is that those hurt
// reading comprehension.

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
    id: 'nature',
    label: 'nature',
    sounds: [
      { id: 'rain', label: 'Rain', icon: '🌧', build: buildRain },
      { id: 'ocean', label: 'Ocean', icon: '🌊', build: buildOcean },
      { id: 'wind', label: 'Wind', icon: '🍃', build: buildWind },
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

// ---------- buffer assembly ----------

function buildBuffer(ctx, seconds, colorFn, envelopeComponents, base = 1, fadeSeconds = 0.35) {
  const sr = ctx.sampleRate;
  const mainLen = Math.floor(sr * seconds);
  const fadeLen = Math.floor(sr * fadeSeconds);
  const totalLen = mainLen + fadeLen;
  const white = whiteSamples(totalLen);
  const colored = colorFn(white);

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
