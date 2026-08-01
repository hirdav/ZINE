// Mind Forest — a living, explorable 2D ecosystem.
//
// Rendered as layered SVG rather than a WebGL diorama: it gives us richer
// painterly artwork (gradients, soft organic shapes, seasonal recoloring)
// and free, robust hit-testing for pan/select/drag — all without a build
// step. Three.js is used for exactly one thing, gated behind its own
// unlock: a soft additive-glow firefly field at night, the one place a
// GPU particle system genuinely beats a handful of DOM nodes. Everything
// else — sway, cloud drift, falling leaves/snow, wildlife flight — is CSS
// or a light rAF loop that only runs while something is actually moving.

import * as THREE from './vendor/three.module.min.js';
import * as forestState from './forest-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WORLD_W = 1000;
const WORLD_H = 620;
const GROUND_CX = 500, GROUND_CY = 470;
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.2, ZOOM_STEP = 0.25;

function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

// ---------- deterministic per-item randomness ----------
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sunflower-seed spiral — items never overlap, the grove reads as one
// continuously-expanding whole, and it stays stable as more items arrive
const SPIRAL_BASE = 22, SPIRAL_COEF = 22;
function spiralRadius(index) { return SPIRAL_BASE + SPIRAL_COEF * Math.sqrt(index + 1); }
function defaultPlacementFor(index) {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const radius = spiralRadius(index);
  const angle = index * GOLDEN;
  return { x: GROUND_CX + Math.cos(angle) * radius * 1.3, y: GROUND_CY - Math.abs(Math.sin(angle)) * radius * 0.55 - radius * 0.15 };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

let gradCounter = 0;
function makeGrad(defs, kind, stops, extra = {}) {
  const id = `fg${gradCounter++}`;
  const grad = svgEl(kind, { id, ...extra });
  stops.forEach(([offset, color, opacity]) => {
    grad.appendChild(svgEl('stop', { offset, 'stop-color': color, 'stop-opacity': opacity != null ? opacity : 1 }));
  });
  defs.appendChild(grad);
  return `url(#${id})`;
}
const linearGrad = (defs, stops, extra) => makeGrad(defs, 'linearGradient', stops, { x1: '0', y1: '0', x2: '0', y2: '1', ...extra });
const radialGrad = (defs, stops, extra) => makeGrad(defs, 'radialGradient', stops, extra);

// smooth organic blob through `points` perturbed radii (Catmull-Rom -> cubic bezier)
function blobPath(cx, cy, rx, ry, rng, points = 9, irregularity = 0.22) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rMod = 1 + (rng() - 0.5) * 2 * irregularity;
    pts.push([cx + Math.cos(a) * rx * rMod, cy + Math.sin(a) * ry * rMod]);
  }
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

function groundShadow(defs, rng, w, h) {
  const grad = radialGrad(defs, [['0%', '#000000', 0.32], ['100%', '#000000', 0]]);
  const el = svgEl('ellipse', { cx: 0, cy: h * 0.06, rx: w, ry: h, fill: grad });
  return el;
}

// ---------- seasonal palettes ----------
const SEASON_FOLIAGE = {
  spring: { dark: '#4f9a55', mid: '#7ec36e', light: '#c8e6a0', accent: '#f2a6c0' },
  summer: { dark: '#2f6b3a', mid: '#4f9a52', light: '#7ec36e', accent: '#ffcc00' },
  autumn: { dark: '#8a4a26', mid: '#c9762f', light: '#e0a53d', accent: '#c94f3d' },
  winter: { dark: '#5a6b63', mid: '#7a8f85', light: '#c9d6d0', accent: '#e8f0ec' },
};
const SEASON_GROUND = {
  spring: ['#5f9257', '#3d6b45'],
  summer: ['#4a7a52', '#2f5233'],
  autumn: ['#a3773f', '#7a5228'],
  winter: ['#dce6e2', '#aab8b2'],
};
const SEASON_SKY_DAY = {
  spring: ['#bfe6e0', '#eaf6d8'],
  summer: ['#8fd0e6', '#d8f0d0'],
  autumn: ['#e8cfa0', '#f2e4c0'],
  winter: ['#d8e4ea', '#f0f4f2'],
};

// ---------- per-kind artwork builders ----------
// Each returns { el: <g class="fs-item-inner">, mobile: bool }. `season` may
// be null for kinds that don't recolor.
function trunkPath(cx, baseY, h, w, rng) {
  const lean = (rng() - 0.5) * w * 1.4;
  return `M ${cx - w / 2} ${baseY} Q ${cx + lean * 0.4} ${baseY - h * 0.55} ${cx + lean} ${baseY - h} ` +
    `L ${cx + lean + w * 0.55} ${baseY - h} Q ${cx + w * 0.35} ${baseY - h * 0.55} ${cx + w / 2} ${baseY} Z`;
}

function buildLeafyTree(defs, rng, { h, trunkColor, season, kindTag }) {
  const g = svgEl('g');
  const w = h * 0.16;
  g.appendChild(svgEl('path', { d: trunkPath(0, 2, h * 0.5, w, rng), fill: trunkColor }));
  const pal = SEASON_FOLIAGE[season] || SEASON_FOLIAGE.summer;
  if (season === 'winter') {
    // bare branches — a few thin forking lines instead of foliage
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.8;
      const len = h * (0.22 + rng() * 0.18);
      const x2 = Math.cos(a) * len, y2 = -h * 0.5 + Math.sin(a) * len;
      g.appendChild(svgEl('path', { d: `M 0 ${-h * 0.5} Q ${x2 * 0.5} ${-h * 0.5 + y2 * 0.4} ${x2} ${y2}`, stroke: trunkColor, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' }));
      if (rng() > 0.4) g.appendChild(svgEl('circle', { cx: x2, cy: y2, r: 3 + rng() * 2.5, fill: '#eef4f1' }));
    }
    return { el: g };
  }
  const gradMain = linearGrad(defs, [['0%', pal.light], ['100%', pal.dark]]);
  const clusters = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < clusters; i++) {
    const cx = (rng() - 0.5) * h * 0.62;
    const cy = -h * (0.62 + rng() * 0.36);
    const r = h * (0.24 + rng() * 0.1);
    g.appendChild(svgEl('path', { d: blobPath(cx, cy, r, r * 0.82, rng, 8, 0.28), fill: gradMain }));
  }
  // sunlit highlight blob for volume
  const hl = svgEl('path', {
    d: blobPath(-h * 0.14, -h * 0.92, h * 0.18, h * 0.14, rng, 7, 0.24),
    fill: pal.light, opacity: 0.55,
  });
  g.appendChild(hl);
  if (season === 'spring' && kindTag !== 'pine') {
    for (let i = 0; i < 6; i++) {
      g.appendChild(svgEl('circle', {
        cx: (rng() - 0.5) * h * 0.66, cy: -h * (0.6 + rng() * 0.38), r: 2.6 + rng() * 1.6, fill: pal.accent, opacity: 0.85,
      }));
    }
  }
  return { el: g };
}

function buildConifer(defs, rng, { h, season }) {
  const g = svgEl('g');
  const w = h * 0.13;
  g.appendChild(svgEl('path', { d: trunkPath(0, 2, h * 0.28, w, rng), fill: '#4a3a2c' }));
  const pal = SEASON_FOLIAGE[season] || SEASON_FOLIAGE.summer;
  const gradMain = linearGrad(defs, [['0%', pal.mid], ['100%', pal.dark]]);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const cy = -h * 0.24 - t * h * 0.32 - h * 0.14;
    const rw = lerp(h * 0.34, h * 0.16, t);
    const rh = h * 0.22;
    g.appendChild(svgEl('path', { d: blobPath(0, cy, rw, rh, rng, 9, 0.16), fill: gradMain }));
    if (season === 'winter') {
      g.appendChild(svgEl('path', { d: blobPath(0, cy - rh * 0.45, rw * 0.78, rh * 0.4, rng, 7, 0.2), fill: '#eef4f1', opacity: 0.85 }));
    }
  }
  return { el: g };
}

function buildFern(defs, rng) {
  const g = svgEl('g');
  const pal = SEASON_FOLIAGE.summer;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6 - 0.5) * 1.7 + (rng() - 0.5) * 0.2;
    const len = 40 + rng() * 18;
    const x2 = Math.cos(a) * len, y2 = Math.sin(a) * len;
    const color = i % 2 === 0 ? pal.mid : pal.dark;
    const blade = svgEl('path', { d: `M 0 2 Q ${x2 * 0.4} ${y2 * 0.5} ${x2} ${y2}`, stroke: color, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
    g.appendChild(blade);
  }
  return { el: g };
}

function buildMushrooms(defs, rng) {
  const g = svgEl('g');
  const capGrad = radialGrad(defs, [['0%', '#ff6a58'], ['100%', '#d43a2c']]);
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const s = 11 + rng() * 11;
    const x = (rng() - 0.5) * 40;
    const stemH = s * 1.4;
    g.appendChild(svgEl('path', { d: `M ${x - s * 0.28} 2 L ${x - s * 0.22} ${-stemH} L ${x + s * 0.22} ${-stemH} L ${x + s * 0.28} 2 Z`, fill: '#f2ede3' }));
    g.appendChild(svgEl('path', { d: blobPath(x, -stemH - s * 0.3, s, s * 0.62, rng, 8, 0.14), fill: capGrad }));
    for (let d = 0; d < 3; d++) {
      g.appendChild(svgEl('circle', { cx: x + (rng() - 0.5) * s, cy: -stemH - s * 0.3 - (rng()) * s * 0.3, r: 1.3, fill: '#fff', opacity: 0.85 }));
    }
  }
  return { el: g };
}

function buildWildflowers(defs, rng) {
  const g = svgEl('g');
  const colors = ['#ff3b30', '#ffcc00', '#f2ede3', '#c94fb0'];
  for (let i = 0; i < 8; i++) {
    const x = (rng() - 0.5) * 62, h = 22 + rng() * 16;
    g.appendChild(svgEl('path', { d: `M ${x} 2 Q ${x + 2} ${-h * 0.5} ${x} ${-h}`, stroke: '#4a7a3a', 'stroke-width': 1.6, fill: 'none' }));
    const color = colors[i % colors.length];
    const cy = -h - 3;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.appendChild(svgEl('ellipse', { cx: x + Math.cos(a) * 4, cy: cy + Math.sin(a) * 4, rx: 3, ry: 2, fill: color, transform: `rotate(${(a * 180) / Math.PI} ${x + Math.cos(a) * 4} ${cy + Math.sin(a) * 4})` }));
    }
    g.appendChild(svgEl('circle', { cx: x, cy, r: 2, fill: '#ffcc00' }));
  }
  return { el: g };
}

function buildBoulder(defs, rng) {
  const g = svgEl('g');
  const grad = linearGrad(defs, [['0%', '#a8a8a8'], ['100%', '#787878']]);
  g.appendChild(svgEl('path', { d: blobPath(0, -19, 34, 21, rng, 8, 0.16), fill: grad }));
  g.appendChild(svgEl('path', { d: blobPath(-8, -30, 13, 8, rng, 6, 0.2), fill: '#6fae4f', opacity: 0.65 }));
  return { el: g };
}

function buildFallenLog(defs, rng) {
  const g = svgEl('g');
  const grad = linearGrad(defs, [['0%', '#7a5a42'], ['100%', '#4a3626']], { x1: '0', y1: '0', x2: '0', y2: '1' });
  g.appendChild(svgEl('rect', { x: -44, y: -24, width: 88, height: 21, rx: 10, fill: grad }));
  g.appendChild(svgEl('ellipse', { cx: 44, cy: -13.5, rx: 10.5, ry: 10.5, fill: '#c9b89a' }));
  g.appendChild(svgEl('ellipse', { cx: 44, cy: -13.5, rx: 6.5, ry: 6.5, fill: '#a88a68' }));
  g.appendChild(svgEl('path', { d: blobPath(-13, -31, 9, 5, rng, 6, 0.2), fill: '#6fae4f', opacity: 0.6 }));
  return { el: g };
}

function buildFireflySwarmMarker(defs, rng) {
  // the actual glow field is the Three.js overlay; this is a small tappable
  // day-visible marker (a cluster of dim motes) so the unlock still has a
  // concrete "thing" planted at a spot in the world
  const g = svgEl('g', { class: 'fs-firefly-marker' });
  for (let i = 0; i < 6; i++) {
    g.appendChild(svgEl('circle', { cx: (rng() - 0.5) * 24, cy: -10 + (rng() - 0.5) * 16, r: 2, fill: '#ffcc00' }));
  }
  return { el: g };
}

function buildPond(defs, rng) {
  const g = svgEl('g');
  const grad = radialGrad(defs, [['0%', '#6fb0c2'], ['100%', '#2f5a6e']]);
  g.appendChild(svgEl('ellipse', { class: 'fs-pond-water', cx: 0, cy: -4, rx: 34, ry: 15, fill: grad }));
  for (let i = 0; i < 3; i++) {
    g.appendChild(svgEl('ellipse', { class: 'fs-pond-ripple', cx: (rng() - 0.5) * 20, cy: -4 + (rng() - 0.5) * 6, rx: 6, ry: 3, fill: 'none', stroke: '#dff4f7', 'stroke-width': 1, opacity: 0.5 }));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    g.appendChild(svgEl('path', { d: `M ${Math.cos(a) * 32} ${-4 + Math.sin(a) * 13} q 2 -8 6 -10`, stroke: '#3f7a45', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }));
  }
  return { el: g };
}

function buildQuadruped(defs, rng, { color, size, tail }) {
  const g = svgEl('g');
  const legColor = color;
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    g.appendChild(svgEl('rect', { x: sx * size * 0.16 - 1.5, y: -size * 0.2, width: 3, height: size * 0.2, fill: legColor, opacity: 0.9 }));
  });
  const bodyGrad = linearGrad(defs, [['0%', color], ['100%', '#00000022']]);
  g.appendChild(svgEl('ellipse', { class: 'fs-quad-body', cx: 0, cy: -size * 0.3, rx: size * 0.3, ry: size * 0.17, fill: bodyGrad }));
  g.appendChild(svgEl('circle', { class: 'fs-quad-head', cx: size * 0.28, cy: -size * 0.4, r: size * 0.13, fill: color }));
  g.appendChild(svgEl('path', { d: `M ${size * 0.34} ${-size * 0.5} l 4 -6 l 3 7 z`, fill: color }));
  if (tail) g.appendChild(tail);
  return { el: g };
}

function buildDeer(defs, rng) {
  const tail = svgEl('path', { d: 'M -14 -32 q -6 -2 -4 6', stroke: '#8a6a4a', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
  return buildQuadruped(defs, rng, { color: '#9a7a54', size: 76, tail });
}
function buildFox(defs, rng) {
  const tail = svgEl('path', { d: 'M -12 -20 q -14 -2 -12 10 q 1 5 8 4', stroke: '#d97a3d', 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' });
  return buildQuadruped(defs, rng, { color: '#d97a3d', size: 52, tail });
}

function buildStarlitCanopy(defs, rng) {
  const g = svgEl('g');
  const grad = linearGrad(defs, [['0%', '#4a6a58'], ['100%', '#243a30']]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * 34, topX = Math.cos(a) * 14;
    g.appendChild(svgEl('path', { d: `M ${x} 2 Q ${topX} -70 ${topX * 0.3} -104`, stroke: '#3a2f28', 'stroke-width': 5, fill: 'none' }));
    g.appendChild(svgEl('path', { d: blobPath(topX * 0.3, -108, 20, 14, rng, 8, 0.2), fill: grad }));
  }
  const starGroup = svgEl('g', { class: 'fs-canopy-stars' });
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, r = 20 + rng() * 46;
    starGroup.appendChild(svgEl('circle', { cx: Math.cos(a) * r, cy: -118 + rng() * 22, r: 1.4, fill: '#f2ede3' }));
  }
  g.appendChild(starGroup);
  return { el: g };
}

function buildButterfly(defs, rng) {
  const g = svgEl('g', { class: 'fs-butterfly' });
  const grad = radialGrad(defs, [['0%', '#ffe066'], ['100%', '#ffcc00']]);
  const l = svgEl('path', { class: 'fs-wing-l', d: 'M 0 0 Q -9 -10 -8 -1 Q -9 8 0 4 Z', fill: grad });
  const r = svgEl('path', { class: 'fs-wing-r', d: 'M 0 0 Q 9 -10 8 -1 Q 9 8 0 4 Z', fill: grad });
  g.appendChild(l); g.appendChild(r);
  g.appendChild(svgEl('line', { x1: 0, y1: -3, x2: 0, y2: 4, stroke: '#2a2a2a', 'stroke-width': 1 }));
  return { el: g, mobile: true, wings: [l, r] };
}

function buildSongbird(defs, rng) {
  const g = svgEl('g', { class: 'fs-songbird' });
  g.appendChild(svgEl('ellipse', { cx: 0, cy: 0, rx: 8, ry: 6, fill: '#8a6a4a' }));
  g.appendChild(svgEl('circle', { cx: 7, cy: -3, r: 4.5, fill: '#8a6a4a' }));
  g.appendChild(svgEl('path', { d: 'M 11 -3 l 5 1.5 l -5 2 z', fill: '#ffcc00' }));
  const wing = svgEl('path', { class: 'fs-wing', d: 'M -2 -1 Q -10 -6 -8 4 Q -3 3 -2 -1 Z', fill: '#6a4a32' });
  g.appendChild(wing);
  return { el: g, mobile: true, wing };
}

const BUILDERS = {
  sprout: (defs, rng) => buildLeafyTree(defs, rng, { h: 34, trunkColor: '#4a7a3a', season: 'summer', kindTag: 'sprout' }),
  sapling: (defs, rng, s) => buildLeafyTree(defs, rng, { h: 68, trunkColor: '#5b4636', season: s.season, kindTag: 'sapling' }),
  fern: (defs, rng) => buildFern(defs, rng),
  'young-pine': (defs, rng, s) => buildConifer(defs, rng, { h: 98, season: s.season }),
  'mature-pine': (defs, rng, s) => buildConifer(defs, rng, { h: 158, season: s.season }),
  'mushroom-cluster': (defs, rng) => buildMushrooms(defs, rng),
  'young-oak': (defs, rng, s) => buildLeafyTree(defs, rng, { h: 108, trunkColor: '#5b4636', season: s.season, kindTag: 'oak' }),
  'mature-oak': (defs, rng, s) => buildLeafyTree(defs, rng, { h: 176, trunkColor: '#4a3a2c', season: s.season, kindTag: 'oak' }),
  'young-birch': (defs, rng, s) => buildLeafyTree(defs, rng, { h: 114, trunkColor: '#e8e2d5', season: s.season, kindTag: 'birch' }),
  'mature-birch': (defs, rng, s) => buildLeafyTree(defs, rng, { h: 182, trunkColor: '#e8e2d5', season: s.season, kindTag: 'birch' }),
  songbird: (defs, rng) => buildSongbird(defs, rng),
  wildflowers: (defs, rng) => buildWildflowers(defs, rng),
  butterfly: (defs, rng) => buildButterfly(defs, rng),
  boulder: (defs, rng) => buildBoulder(defs, rng),
  'fallen-log': (defs, rng) => buildFallenLog(defs, rng),
  'firefly-swarm': (defs, rng) => buildFireflySwarmMarker(defs, rng),
  pond: (defs, rng) => buildPond(defs, rng),
  deer: (defs, rng) => buildDeer(defs, rng),
  fox: (defs, rng) => buildFox(defs, rng),
  'starlit-canopy': (defs, rng) => buildStarlitCanopy(defs, rng),
};

const HIT_RADIUS = {
  sprout: 22, sapling: 34, fern: 26, 'young-pine': 42, 'mature-pine': 62,
  'mushroom-cluster': 28, 'young-oak': 48, 'mature-oak': 70, 'young-birch': 50, 'mature-birch': 74,
  songbird: 22, wildflowers: 30, butterfly: 20, boulder: 30, 'fallen-log': 40,
  'firefly-swarm': 26, pond: 36, deer: 40, fox: 30, 'starlit-canopy': 60, grove: 60,
};

function nightFactorFor(hours) {
  if (hours >= 7 && hours <= 17) return 0;
  if (hours >= 20 || hours <= 4) return 1;
  if (hours > 17 && hours < 20) return (hours - 17) / 3;
  return 1 - (hours - 4) / 3;
}
function hexLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(lerp(ar, br, t)), gC = Math.round(lerp(ag, bg, t)), b2 = Math.round(lerp(ab, bb, t));
  return `rgb(${r},${gC},${b2})`;
}

// ---------- Three.js firefly overlay (the one place WebGL earns its keep) ----------
class FireflyField {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, WORLD_W, 0, WORLD_H, -10, 10);
    const count = 22;
    const positions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    this.bases = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = 40 + Math.random() * (WORLD_W - 80);
      const y = 200 + Math.random() * (WORLD_H - 260);
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = 0;
      this.bases[i * 2] = x; this.bases[i * 2 + 1] = y;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const tex = this._glowTexture();
    this.mat = new THREE.PointsMaterial({
      size: 16, map: tex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffdd77,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.scene.add(this.points);
  }

  _glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.4, 'rgba(255,220,120,0.7)');
    grad.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  setSize(w, h) { this.renderer.setSize(w, h, false); }

  update(t, nightFactor) {
    this.mat.opacity = Math.max(0, nightFactor - 0.15) * 0.95;
    if (this.mat.opacity <= 0.01) return;
    const pos = this.points.geometry.attributes.position;
    const n = this.phases.length;
    for (let i = 0; i < n; i++) {
      pos.array[i * 3] = this.bases[i * 2] + Math.sin(t * 0.5 + this.phases[i]) * 26;
      pos.array[i * 3 + 1] = this.bases[i * 2 + 1] + Math.cos(t * 0.6 + this.phases[i] * 1.3) * 18;
    }
    pos.needsUpdate = true;
  }

  render() { this.renderer.render(this.scene, this.camera); }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
    this.mat.map.dispose();
    this.renderer.dispose();
  }
}

// ---------- the scene ----------
export class MindForestScene {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'forest-scene-root';

    this.svg = svgEl('svg', { class: 'forest-svg', viewBox: `0 0 ${WORLD_W} ${WORLD_H}`, preserveAspectRatio: 'xMidYMid slice' });
    this.defs = svgEl('defs');
    this.svg.appendChild(this.defs);
    this.el.appendChild(this.svg);

    this.particleCanvas = document.createElement('canvas');
    this.particleCanvas.className = 'forest-particle-layer';
    this.el.appendChild(this.particleCanvas);

    this.popover = document.createElement('div');
    this.popover.className = 'forest-popover hidden';
    this.el.appendChild(this.popover);

    this.zoomControls = document.createElement('div');
    this.zoomControls.className = 'forest-zoom-controls';
    this.zoomOutBtn = document.createElement('button');
    this.zoomOutBtn.type = 'button';
    this.zoomOutBtn.className = 'forest-zoom-btn';
    this.zoomOutBtn.title = 'Zoom out';
    this.zoomOutBtn.textContent = '−';
    this.zoomInBtn = document.createElement('button');
    this.zoomInBtn.type = 'button';
    this.zoomInBtn.className = 'forest-zoom-btn';
    this.zoomInBtn.title = 'Zoom in';
    this.zoomInBtn.textContent = '+';
    this.zoomControls.appendChild(this.zoomOutBtn);
    this.zoomControls.appendChild(this.zoomInBtn);
    this.el.appendChild(this.zoomControls);
    this.zoomOutBtn.addEventListener('click', () => this._setZoom(this._zoom - ZOOM_STEP));
    this.zoomInBtn.addEventListener('click', () => this._setZoom(this._zoom + ZOOM_STEP));

    this.itemNodes = new Map(); // id -> { outer, inner, item }
    this.mobileNodes = [];
    this.selectedId = null;
    this._running = false;
    this._raf = null;
    this._dayNightTimer = null;
    this._startTime = performance.now();
    this.nightFactor = 0;
    this.season = forestState.getSeason();
    this.fireflies = null;
    this._panX = 0; this._panY = 0;
    this._zoom = 1;
    this._activePointers = new Map();
    this._pinchStartDist = null;
    this._pinchStartZoom = 1;

    this._buildStatic();
    this._buildLeafAndSnowParticles();
    this._wireInteraction();
    this._applyWorldTransform();
    this._updateZoomButtons();

    this._onVisibility = () => { if (document.hidden) this.stop(); else this.start(); };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _buildStatic() {
    this.skyRect = svgEl('rect', { x: 0, y: 0, width: WORLD_W, height: WORLD_H, class: 'fs-sky' });
    this.svg.appendChild(this.skyRect);

    this.nightOverlay = svgEl('rect', { x: 0, y: 0, width: WORLD_W, height: WORLD_H, fill: '#0a1330', opacity: 0 });
    this.svg.appendChild(this.nightOverlay);

    this.starsGroup = svgEl('g', { class: 'fs-stars', opacity: 0 });
    for (let i = 0; i < 50; i++) {
      const rng = Math.random;
      this.starsGroup.appendChild(svgEl('circle', {
        cx: rng() * WORLD_W, cy: rng() * WORLD_H * 0.55, r: 0.6 + rng() * 1.2, fill: '#fff', opacity: 0.4 + rng() * 0.5,
      }));
    }
    this.svg.appendChild(this.starsGroup);

    this.cloudsGroup = svgEl('g', { class: 'fs-clouds' });
    for (let i = 0; i < 5; i++) {
      const rng = mulberry32(i * 71 + 3);
      const cloud = svgEl('g', {
        class: 'fs-cloud',
        style: `--fs-cloud-dur:${90 + rng() * 90}s; --fs-cloud-delay:${-rng() * 120}s;`,
        transform: `translate(0, ${40 + rng() * 90})`,
      });
      for (let b = 0; b < 4; b++) {
        cloud.appendChild(svgEl('ellipse', {
          cx: b * 22 - 30 + rng() * 10, cy: -rng() * 6, rx: 24 + rng() * 10, ry: 13 + rng() * 5,
          fill: '#ffffff', opacity: 0.55,
        }));
      }
      this.cloudsGroup.appendChild(cloud);
    }
    this.svg.appendChild(this.cloudsGroup);

    const hillsRng = mulberry32(99);
    this.hillsBack = svgEl('path', { class: 'fs-hills-back', d: this._hillPath(hillsRng, 330, 40) });
    this.svg.appendChild(this.hillsBack);
    this.hillsMid = svgEl('path', { class: 'fs-hills-mid', d: this._hillPath(mulberry32(41), 370, 30) });
    this.svg.appendChild(this.hillsMid);

    this.world = svgEl('g', { class: 'fs-world' });
    this.svg.appendChild(this.world);

    this.groundPath = svgEl('path', { class: 'fs-ground', d: blobPath(GROUND_CX, GROUND_CY + 60, 160, 80, mulberry32(7), 14, 0.1) });
    this.world.appendChild(this.groundPath);

    this.itemsLayer = svgEl('g', { class: 'fs-items' });
    this.world.appendChild(this.itemsLayer);

    this._applyPalette();
  }

  _hillPath(rng, baseY, amp) {
    let d = `M 0 ${WORLD_H} L 0 ${baseY} `;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * WORLD_W;
      const y = baseY - Math.sin(i * 1.3 + rng() * 3) * amp - rng() * amp * 0.4;
      d += `${i === 0 ? 'L' : 'S'} ${x - WORLD_W / steps / 2} ${y} ${x} ${y} `;
    }
    return d + `L ${WORLD_W} ${WORLD_H} Z`;
  }

  _applyPalette() {
    const sky = SEASON_SKY_DAY[this.season] || SEASON_SKY_DAY.summer;
    const ground = SEASON_GROUND[this.season] || SEASON_GROUND.summer;
    if (this._skyGradId == null) {
      this._skyStopTop = svgEl('stop', { offset: '0%', 'stop-color': sky[0] });
      this._skyStopBot = svgEl('stop', { offset: '100%', 'stop-color': sky[1] });
      const grad = svgEl('linearGradient', { id: 'fsSkyGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
      grad.appendChild(this._skyStopTop);
      grad.appendChild(this._skyStopBot);
      this.defs.appendChild(grad);
      this.skyRect.setAttribute('fill', 'url(#fsSkyGrad)');
      this._skyGradId = 'fsSkyGrad';

      this._groundStopTop = svgEl('stop', { offset: '0%', 'stop-color': ground[0] });
      this._groundStopBot = svgEl('stop', { offset: '100%', 'stop-color': ground[1] });
      const ggrad = svgEl('linearGradient', { id: 'fsGroundGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
      ggrad.appendChild(this._groundStopTop);
      ggrad.appendChild(this._groundStopBot);
      this.defs.appendChild(ggrad);
      this.groundPath.setAttribute('fill', 'url(#fsGroundGrad)');
      this.hillsBack.setAttribute('fill', hexLerp(ground[1], '#00000000'.slice(0, 7), 0) || ground[1]);
      this.hillsBack.setAttribute('opacity', 0.5);
      this.hillsMid.setAttribute('opacity', 0.7);
    } else {
      this._skyStopTop.setAttribute('stop-color', sky[0]);
      this._skyStopBot.setAttribute('stop-color', sky[1]);
      this._groundStopTop.setAttribute('stop-color', ground[0]);
      this._groundStopBot.setAttribute('stop-color', ground[1]);
    }
    this.hillsBack.setAttribute('fill', ground[1]);
    this.hillsMid.setAttribute('fill', ground[0]);
    this.el.classList.toggle('season-winter', this.season === 'winter');
    this.el.classList.toggle('season-autumn', this.season === 'autumn');
  }

  _buildLeafAndSnowParticles() {
    this.weatherLayer = document.createElement('div');
    this.weatherLayer.className = 'forest-weather-layer';
    this.el.appendChild(this.weatherLayer);
    this._renderWeatherParticles();
  }

  _renderWeatherParticles() {
    this.weatherLayer.innerHTML = '';
    const kind = this.season === 'autumn' ? 'leaf' : this.season === 'winter' ? 'snow' : null;
    if (!kind) return;
    const count = 10;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = `forest-particle forest-particle-${kind}`;
      const dur = 7 + Math.random() * 6;
      const delay = -Math.random() * dur;
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDuration = `${dur}s`;
      p.style.animationDelay = `${delay}s`;
      p.style.setProperty('--drift', `${(Math.random() - 0.5) * 60}px`);
      this.weatherLayer.appendChild(p);
    }
  }

  // ---------- interaction: pan background, select/drag items, zoom ----------
  _wireInteraction() {
    let panning = false, dragId = null, moved = false;
    let startClientX = 0, startClientY = 0, startPanX = 0, startPanY = 0;
    const DRAG_THRESHOLD = 6;

    const toWorldPoint = (el, clientX, clientY) => {
      const ctm = el.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const pt = this.svg.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    };

    const pointerDistance = () => {
      const pts = [...this._activePointers.values()];
      if (pts.length < 2) return 1;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    };

    this.svg.addEventListener('pointerdown', (e) => {
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._activePointers.size === 2) {
        // second finger down — switch to pinch-zoom, abandon any drag/pan
        dragId = null; panning = false;
        this._closePopover();
        this._pinchStartDist = pointerDistance();
        this._pinchStartZoom = this._zoom;
        return;
      }
      if (this._activePointers.size > 2) return;

      this._closePopover();
      const itemEl = e.target.closest('.fs-item');
      if (itemEl && !itemEl.classList.contains('fs-item-mobile')) {
        dragId = itemEl.dataset.id;
        moved = false;
        startClientX = e.clientX; startClientY = e.clientY;
        try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
        e.stopPropagation();
        return;
      }
      if (itemEl && itemEl.classList.contains('fs-item-mobile')) {
        // mobile (flying) wildlife: selectable only, no drag
        this._selectItem(itemEl.dataset.id, itemEl);
        e.stopPropagation();
        return;
      }
      panning = true;
      startClientX = e.clientX; startClientY = e.clientY;
      startPanX = this._panX; startPanY = this._panY;
      try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    });

    this.svg.addEventListener('pointermove', (e) => {
      if (this._activePointers.has(e.pointerId)) this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._activePointers.size === 2 && this._pinchStartDist) {
        const ratio = pointerDistance() / this._pinchStartDist;
        this._setZoom(this._pinchStartZoom * ratio);
        return;
      }

      if (dragId) {
        const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
        if (moved) {
          const node = this.itemNodes.get(dragId);
          if (node) {
            const wp = toWorldPoint(this.world, e.clientX, e.clientY);
            node.outer.setAttribute('transform', `translate(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`);
            node.x = wp.x; node.y = wp.y;
          }
        }
        return;
      }
      if (panning) {
        const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
        const ctm = this.svg.getScreenCTM();
        const scale = ctm ? ctm.a : 1;
        this._panX = clamp(startPanX + dx / scale, -320, 320);
        this._panY = clamp(startPanY + dy / scale, -180, 140);
        this._applyWorldTransform();
      }
    });

    const endPointer = (e) => {
      this._activePointers.delete(e.pointerId);
      if (this._activePointers.size < 2) this._pinchStartDist = null;

      if (dragId) {
        const node = this.itemNodes.get(dragId);
        if (node && moved) {
          forestState.setItemPosition(dragId, node.x, node.y);
        } else if (node && !moved) {
          this._selectItem(dragId, node.outer);
        }
        dragId = null; moved = false;
      }
      panning = false;
    };
    this.svg.addEventListener('pointerup', endPointer);
    this.svg.addEventListener('pointercancel', endPointer);

    // trackpad pinch surfaces as a ctrl-modified wheel event in every major
    // browser — hook that without hijacking normal page-scroll wheel input
    this.svg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this._setZoom(this._zoom * (e.deltaY > 0 ? 0.92 : 1.08));
    }, { passive: false });

    this.popover.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  _applyWorldTransform() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    this.world.setAttribute('transform',
      `translate(${this._panX.toFixed(1)}, ${this._panY.toFixed(1)}) translate(${cx}, ${cy}) scale(${this._zoom.toFixed(3)}) translate(${-cx}, ${-cy})`);
  }

  _setZoom(z) {
    this._zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    this._applyWorldTransform();
    this._updateZoomButtons();
  }

  _updateZoomButtons() {
    if (!this.zoomInBtn) return;
    this.zoomInBtn.disabled = this._zoom >= ZOOM_MAX - 0.001;
    this.zoomOutBtn.disabled = this._zoom <= ZOOM_MIN + 0.001;
  }

  _selectItem(id, outerEl) {
    if (this.selectedId && this.selectedId !== id) {
      const prev = this.itemNodes.get(this.selectedId);
      if (prev) prev.outer.classList.remove('selected');
    }
    this.selectedId = id;
    outerEl.classList.add('selected');
    this._openPopover(id, outerEl);
  }

  _closePopover() {
    this.popover.classList.add('hidden');
    if (this.selectedId) {
      const prev = this.itemNodes.get(this.selectedId);
      if (prev) prev.outer.classList.remove('selected');
    }
    this.selectedId = null;
  }

  _openPopover(id, outerEl) {
    const node = this.itemNodes.get(id);
    if (!node) return;
    const item = node.item;
    const record = forestState.getUnlockRecord(id);
    const icon = forestState.KIND_ICONS[item.kind] || '🌱';

    this.popover.innerHTML = '';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'forest-popover-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this._closePopover());

    const head = document.createElement('div');
    head.className = 'forest-popover-head';
    const iconEl = document.createElement('span');
    iconEl.className = 'forest-popover-icon';
    iconEl.textContent = icon;
    const titleEl = document.createElement('span');
    titleEl.className = 'forest-popover-title';
    titleEl.textContent = item.label;
    head.appendChild(iconEl);
    head.appendChild(titleEl);

    const story = document.createElement('p');
    story.className = 'forest-popover-story';
    story.textContent = record
      ? `Planted ${formatRelative(record.unlockedAt)} · reading session #${record.totalSessions} · day ${record.streak} of your streak.`
      : 'Grown before your Mind Forest kept a diary of each planting.';

    this.popover.appendChild(closeBtn);
    this.popover.appendChild(head);
    this.popover.appendChild(story);
    this.popover.classList.remove('hidden');

    // position near the item, clamped inside the container
    const hostRect = this.el.getBoundingClientRect();
    const itemRect = outerEl.getBoundingClientRect();
    this.popover.style.left = '0px';
    this.popover.style.top = '0px';
    const pw = this.popover.offsetWidth || 220, ph = this.popover.offsetHeight || 90;
    let left = itemRect.left - hostRect.left + itemRect.width / 2 - pw / 2;
    let top = itemRect.top - hostRect.top - ph - 12;
    left = clamp(left, 8, Math.max(8, hostRect.width - pw - 8));
    if (top < 4) top = itemRect.top - hostRect.top + itemRect.height + 12;
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  setSize(w, h) {
    if (w <= 0 || h <= 0) return;
    if (this.fireflies) this.fireflies.setSize(w, h);
  }

  setUnlockedItems(items) {
    this.season = forestState.getSeason();
    this._applyPalette();
    this._renderWeatherParticles();

    items.forEach((item, index) => {
      if (this.itemNodes.has(item.id)) return;
      this._addItem(item, index);
      if (item.kind === 'firefly-swarm' && !this.fireflies && isWebGLAvailable()) {
        this.fireflies = new FireflyField(this.particleCanvas);
        const rect = this.el.getBoundingClientRect();
        this.fireflies.setSize(rect.width || 300, rect.height || 200);
      }
    });
    this._updateGroundSize(items.length);
  }

  // the clearing grows along with the spiral so a young forest reads as a
  // cozy, prominent clump and an old one has room to spread into — the
  // ground is never the thing that makes items feel small or lost
  _updateGroundSize(count) {
    const maxRadius = count <= 0 ? 90 : spiralRadius(count - 1);
    const rx = Math.max(160, maxRadius * 1.4 + 60);
    const ry = Math.max(80, maxRadius * 0.85 + 50);
    if (this._groundRx === rx) return;
    this._groundRx = rx;
    this.groundPath.setAttribute('d', blobPath(GROUND_CX, GROUND_CY + 60, rx, ry, mulberry32(7), 14, 0.1));
  }

  _addItem(item, index) {
    const rng = mulberry32(index * 97 + 13);
    const build = BUILDERS[item.kind] || BUILDERS.sapling;
    const built = build(this.defs, rng, { season: this.season });

    const pos = forestState.getItemPosition(item.id) || defaultPlacementFor(index);
    const outer = svgEl('g', { class: 'fs-item', 'data-id': item.id, transform: `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})` });
    if (built.mobile) outer.classList.add('fs-item-mobile');

    // small/sparse artwork (a thin stem, a few dots) leaves mostly empty
    // space inside its own bounding box — an invisible, generously-sized
    // hit target keeps tapping and dragging reliable regardless of how
    // little ink the item itself puts down
    const hitR = HIT_RADIUS[item.kind] || 32;
    outer.appendChild(svgEl('circle', { cx: 0, cy: -hitR * 0.6, r: hitR, fill: 'none', 'pointer-events': 'all' }));

    const shadow = groundShadow(this.defs, rng, 18, 5);
    outer.appendChild(shadow);

    const inner = svgEl('g', { class: 'fs-item-inner' });
    const swayAmp = (1.5 + rng() * 2).toFixed(2);
    const swayDur = (3.2 + rng() * 2.6).toFixed(2);
    const swayDelay = (-rng() * swayDur).toFixed(2);
    inner.setAttribute('style', `--sway-amp:${swayAmp}deg; --sway-dur:${swayDur}s; --sway-delay:${swayDelay}s;`);
    inner.classList.add('fs-grow-in');
    if (!['boulder', 'fallen-log', 'pond', 'mushroom-cluster', 'firefly-swarm'].includes(item.kind)) {
      inner.classList.add('fs-sway');
    }
    inner.appendChild(built.el);
    outer.appendChild(inner);

    this.itemsLayer.appendChild(outer);
    const node = { outer, inner, item, x: pos.x, y: pos.y, built };
    this.itemNodes.set(item.id, node);
    if (built.mobile) this.mobileNodes.push(node);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._dayNightTimer = setInterval(() => this._updateDayNight(), 2000);
    this._updateDayNight();
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      this._tick();
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._dayNightTimer) clearInterval(this._dayNightTimer);
    this._dayNightTimer = null;
  }

  _updateDayNight() {
    const now = new Date();
    this.nightFactor = nightFactorFor(now.getHours() + now.getMinutes() / 60);
    this.nightOverlay.setAttribute('opacity', (this.nightFactor * 0.55).toFixed(2));
    this.starsGroup.setAttribute('opacity', clamp(this.nightFactor * 1.3 - 0.2, 0, 1).toFixed(2));
    const season = forestState.getSeason();
    if (season !== this.season) {
      this.season = season;
      this._applyPalette();
      this._renderWeatherParticles();
    }
  }

  _tick() {
    const t = (performance.now() - this._startTime) / 1000;
    for (const node of this.mobileNodes) {
      const rng = mulberry32(node.item.id.length * 31 + 7);
      const phase = (node.item.id.charCodeAt(0) || 1) * 0.7;
      const isButterfly = node.item.kind === 'butterfly';
      const speed = isButterfly ? 0.35 : 0.22;
      const orbitR = isButterfly ? 90 : 70;
      const cx = GROUND_CX + (isButterfly ? -60 : 90);
      const cy = GROUND_CY - 140;
      const x = cx + Math.cos(t * speed + phase) * orbitR;
      const y = cy + Math.sin(t * speed * 1.4 + phase) * orbitR * 0.4;
      node.outer.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
      if (node.built.wings) {
        const flap = Math.sin(t * 10 + phase) * 35;
        node.built.wings[0].setAttribute('transform', `rotate(${flap})`);
        node.built.wings[1].setAttribute('transform', `rotate(${-flap})`);
      }
      if (node.built.wing) {
        node.built.wing.setAttribute('transform', `rotate(${Math.sin(t * 9 + phase) * 22})`);
      }
    }
    if (this.fireflies) {
      this.fireflies.update(t, this.nightFactor);
      this.fireflies.render();
    }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.fireflies) this.fireflies.dispose();
  }
}

function formatRelative(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
