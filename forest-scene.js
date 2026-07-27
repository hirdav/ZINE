// Mind Forest — a small, lightweight Three.js diorama.
//
// Deliberately not a "3D scene" in the heavy sense: a handful of low-poly
// procedural shapes (no model loading, no textures beyond a couple of
// generated canvases), flat shading, no shadow maps, capped pixel ratio, and
// the render loop stops entirely whenever the tab or panel isn't visible.
// Every element it can draw comes from forest-state's unlock catalog — this
// module only knows how to turn a `kind` string into geometry.

import * as THREE from './vendor/three.module.min.js';

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
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

// sunflower-seed spiral so items never overlap and the grove reads as one
// continuously-expanding whole rather than a grid
function placementFor(index) {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const radius = 1.55 * Math.sqrt(index + 1);
  const angle = index * GOLDEN;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ---------- shared build helpers ----------
function trunk(rng, height, radius, color = 0x5b4636) {
  const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 6);
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  return mesh;
}

function foliageCluster(rng, baseY, count, spread, size, color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  for (let i = 0; i < count; i++) {
    const geo = new THREE.IcosahedronGeometry(size * (0.75 + rng() * 0.5), 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (rng() - 0.5) * spread,
      baseY + rng() * spread * 0.6,
      (rng() - 0.5) * spread
    );
    group.add(mesh);
  }
  return group;
}

function swayingAnimate(group, ampl = 0.03, speed = 0.6, phase = 0) {
  const baseRot = group.rotation.z;
  group.userData.animate = (t) => {
    group.rotation.z = baseRot + Math.sin(t * speed + phase) * ampl;
  };
}

// ---------- per-kind builders ----------
function buildSprout(rng) {
  const g = new THREE.Group();
  const stem = trunk(rng, 0.16, 0.02, 0x4a7a3a);
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.18, 5),
    new THREE.MeshLambertMaterial({ color: 0x6fae4f, flatShading: true })
  );
  leaf.position.y = 0.22;
  g.add(stem, leaf);
  swayingAnimate(g, 0.05, 1.1);
  return g;
}

function buildSapling(rng) {
  const g = new THREE.Group();
  g.add(trunk(rng, 0.5, 0.045, 0x5b4636));
  g.add(foliageCluster(rng, 0.45, 3, 0.28, 0.2, 0x6fae4f));
  swayingAnimate(g, 0.035, 0.8);
  return g;
}

function buildFern(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3f7a45, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 3), mat);
    const a = (i / 6) * Math.PI * 2 + rng() * 0.3;
    blade.position.set(Math.cos(a) * 0.08, 0.2, Math.sin(a) * 0.08);
    blade.rotation.z = Math.cos(a) * 0.5;
    blade.rotation.x = Math.sin(a) * 0.5;
    g.add(blade);
  }
  swayingAnimate(g, 0.06, 1.4);
  return g;
}

function buildConiferTree(rng, height, color) {
  const g = new THREE.Group();
  g.add(trunk(rng, height * 0.3, 0.08, 0x4a3a2c));
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(lerp(0.42, 0.2, t), height * 0.42, 7), mat);
    cone.position.y = height * 0.32 + t * height * 0.42 + height * 0.2;
    g.add(cone);
  }
  swayingAnimate(g, 0.02, 0.5, rng() * Math.PI);
  return g;
}
const buildYoungPine = (rng) => buildConiferTree(rng, 1.1, 0x3f6b3f);
const buildMaturePine = (rng) => buildConiferTree(rng, 1.9, 0x2f5233);

function buildBroadleafTree(rng, height, trunkColor, leafColor) {
  const g = new THREE.Group();
  g.add(trunk(rng, height * 0.55, 0.1, trunkColor));
  g.add(foliageCluster(rng, height * 0.55, 5, height * 0.55, height * 0.28, leafColor));
  swayingAnimate(g, 0.025, 0.45, rng() * Math.PI);
  return g;
}
const buildYoungOak = (rng) => buildBroadleafTree(rng, 1.2, 0x5b4636, 0x77a35c);
const buildMatureOak = (rng) => buildBroadleafTree(rng, 2.1, 0x4a3a2c, 0x5b8a4a);
const buildYoungBirch = (rng) => buildBroadleafTree(rng, 1.3, 0xe8e2d5, 0x9fc46f);
const buildMatureBirch = (rng) => buildBroadleafTree(rng, 2.2, 0xe8e2d5, 0x8fbf6b);

function buildMushroomCluster(rng) {
  const g = new THREE.Group();
  const capMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, flatShading: true });
  const stemMat = new THREE.MeshLambertMaterial({ color: 0xf2ede3, flatShading: true });
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.08 + rng() * 0.1;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.35, s * 1.4, 6), stemMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    cap.position.y = s * 0.7;
    const group = new THREE.Group();
    group.add(stem, cap);
    stem.position.y = s * 0.7;
    group.position.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
    g.add(group);
  }
  return g;
}

function buildWildflowers(rng) {
  const g = new THREE.Group();
  const colors = [0xff3b30, 0xffcc00, 0xf2ede3];
  for (let i = 0; i < 7; i++) {
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3a, flatShading: true });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.22, 4), stemMat);
    const flower = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.045, 0),
      new THREE.MeshLambertMaterial({ color: colors[i % colors.length], flatShading: true })
    );
    flower.position.y = 0.13;
    const s = new THREE.Group();
    s.add(stem, flower);
    stem.position.y = 0.11;
    s.position.set((rng() - 0.5) * 0.45, 0, (rng() - 0.5) * 0.45);
    g.add(s);
  }
  swayingAnimate(g, 0.05, 1.2);
  return g;
}

function buildButterfly(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffcc00, flatShading: true, side: THREE.DoubleSide });
  const l = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8, 0, Math.PI), mat);
  const r = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8, 0, Math.PI), mat);
  r.rotation.y = Math.PI;
  g.add(l, r);
  g.position.y = 0.5;
  const phase = rng() * Math.PI * 2;
  const orbitR = 0.5 + rng() * 0.3;
  g.userData.animate = (t) => {
    l.rotation.y = Math.sin(t * 6 + phase) * 0.9;
    r.rotation.y = Math.PI - Math.sin(t * 6 + phase) * 0.9;
    g.position.x = Math.cos(t * 0.5 + phase) * orbitR;
    g.position.z = Math.sin(t * 0.5 + phase) * orbitR;
    g.position.y = 0.5 + Math.sin(t * 2 + phase) * 0.12;
    g.rotation.y = -t * 0.5 - phase + Math.PI / 2;
  };
  return g;
}

function buildSongbird(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), mat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), mat);
  head.position.set(0.09, 0.06, 0);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.06, 4),
    new THREE.MeshLambertMaterial({ color: 0xffcc00, flatShading: true })
  );
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.15, 0.06, 0);
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x6a4a32, flatShading: true, side: THREE.DoubleSide });
  const wing = new THREE.Mesh(new THREE.CircleGeometry(0.08, 6, 0, Math.PI), wingMat);
  wing.rotation.x = Math.PI / 2;
  wing.position.set(-0.02, 0.02, 0);
  const perch = trunk(rng, 0.35, 0.015, 0x4a3a2c);
  g.add(perch, body, head, beak, wing);
  body.position.y = perch.position.y + 0.28;
  head.position.y += perch.position.y + 0.28;
  beak.position.y += perch.position.y + 0.28;
  wing.position.y += perch.position.y + 0.28;
  const phase = rng() * Math.PI * 2;
  g.userData.animate = (t) => {
    wing.rotation.z = Math.sin(t * 8 + phase) * 0.3;
    g.rotation.y = Math.sin(t * 0.3 + phase) * 0.5;
  };
  return g;
}

function buildBoulder(rng) {
  const geo = new THREE.DodecahedronGeometry(0.3 + rng() * 0.15, 0);
  geo.scale(1, 0.7, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a8a8a, flatShading: true }));
  mesh.rotation.y = rng() * Math.PI;
  mesh.position.y = 0.15;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function buildFallenLog(rng) {
  const g = new THREE.Group();
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.16, 1.3, 7),
    new THREE.MeshLambertMaterial({ color: 0x5b4636, flatShading: true })
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.14;
  const endMat = new THREE.MeshLambertMaterial({ color: 0xc9b89a, flatShading: true });
  const end = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), endMat);
  end.rotation.y = Math.PI / 2;
  end.position.set(0.65, 0.14, 0);
  g.add(log, end);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

function buildFireflySwarm(rng) {
  const count = 10;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * 1.1;
    positions[i * 3 + 1] = 0.2 + rng() * 0.5;
    positions[i * 3 + 2] = (rng() - 0.5) * 1.1;
    phases[i] = rng() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffcc00, size: 0.06, transparent: true, opacity: 0,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  const g = new THREE.Group();
  g.add(points);
  const basePos = positions.slice();
  g.userData.animate = (t, nightFactor) => {
    mat.opacity = Math.max(0, nightFactor - 0.2) * 0.9;
    const pos = geo.attributes.position;
    for (let i = 0; i < count; i++) {
      pos.array[i * 3] = basePos[i * 3] + Math.sin(t * 0.8 + phases[i]) * 0.15;
      pos.array[i * 3 + 1] = basePos[i * 3 + 1] + Math.sin(t * 1.3 + phases[i] * 2) * 0.1;
      pos.array[i * 3 + 2] = basePos[i * 3 + 2] + Math.cos(t * 0.7 + phases[i]) * 0.15;
    }
    pos.needsUpdate = true;
  };
  return g;
}

function buildPond(rng) {
  const geo = new THREE.CircleGeometry(0.55, 20);
  const mat = new THREE.MeshLambertMaterial({ color: 0x3f6b7a, flatShading: true, transparent: true, opacity: 0.88 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.animate = (t) => {
    mat.opacity = 0.8 + Math.sin(t * 0.6) * 0.06;
  };
  return g;
}

function buildQuadruped(rng, bodyColor, size, tailFn) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, size * 0.32, size * 0.24), mat);
  body.position.y = size * 0.42;
  const head = new THREE.Mesh(new THREE.BoxGeometry(size * 0.2, size * 0.2, size * 0.18), mat);
  head.position.set(size * 0.32, size * 0.5, 0);
  const legMat = mat;
  const legs = [];
  const lx = size * 0.18, lz = size * 0.1;
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.035, size * 0.035, size * 0.36, 5), legMat);
    leg.position.set(sx * lx, size * 0.18, sz * lz);
    legs.push(leg);
    g.add(leg);
  });
  const ear = new THREE.Mesh(new THREE.ConeGeometry(size * 0.05, size * 0.14, 4), mat);
  ear.position.set(size * 0.3, size * 0.62, 0);
  g.add(body, head, ear);
  if (tailFn) g.add(tailFn(size, mat));
  g.rotation.y = rng() * Math.PI * 2;
  const phase = rng() * Math.PI * 2;
  g.userData.animate = (t) => {
    head.rotation.y = Math.sin(t * 0.4 + phase) * 0.3;
  };
  return g;
}

function buildDeer(rng) {
  return buildQuadruped(rng, 0x8a6a4a, 1, (size, mat) => {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(size * 0.04, size * 0.1, 4), mat);
    tail.position.set(-size * 0.26, size * 0.46, 0);
    tail.rotation.z = Math.PI / 2;
    return tail;
  });
}

function buildFox(rng) {
  return buildQuadruped(rng, 0xd97a3d, 0.65, (size, mat) => {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(size * 0.09, size * 0.4, 6), mat);
    tail.position.set(-size * 0.32, size * 0.42, 0);
    tail.rotation.z = Math.PI * 0.65;
    return tail;
  });
}

function buildStarlitCanopy(rng) {
  const g = new THREE.Group();
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3d5a4a, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2f28, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.6, 5), trunkMat);
    t.position.set(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5);
    t.rotation.z = Math.cos(a) * 0.25;
    t.rotation.x = -Math.sin(a) * 0.25;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), leafMat);
    leaf.position.set(Math.cos(a) * 0.5, 1.7, Math.sin(a) * 0.5);
    g.add(t, leaf);
  }
  const starCount = 24;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.3 + rng() * 0.9;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 1.9 + rng() * 0.5;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xf2ede3, size: 0.05, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(geo, starMat);
  g.add(stars);
  g.userData.animate = (t, nightFactor) => {
    starMat.opacity = nightFactor * (0.6 + Math.sin(t * 2) * 0.15);
  };
  return g;
}

const BUILDERS = {
  sprout: buildSprout,
  sapling: buildSapling,
  fern: buildFern,
  'young-pine': buildYoungPine,
  'mushroom-cluster': buildMushroomCluster,
  'young-oak': buildYoungOak,
  songbird: buildSongbird,
  wildflowers: buildWildflowers,
  'young-birch': buildYoungBirch,
  butterfly: buildButterfly,
  'mature-pine': buildMaturePine,
  boulder: buildBoulder,
  'fallen-log': buildFallenLog,
  'mature-oak': buildMatureOak,
  'firefly-swarm': buildFireflySwarm,
  pond: buildPond,
  'mature-birch': buildMatureBirch,
  deer: buildDeer,
  fox: buildFox,
  'starlit-canopy': buildStarlitCanopy,
};

// ---------- day/night mood ----------
function nightFactorFor(hours) {
  if (hours >= 7 && hours <= 17) return 0;
  if (hours >= 20 || hours <= 4) return 1;
  if (hours > 17 && hours < 20) return (hours - 17) / 3;
  return 1 - (hours - 4) / 3; // 4..7 dawn ramp
}

const SKY_DAY = new THREE.Color(0x9fd0e6);
const SKY_NIGHT = new THREE.Color(0x0c1220);
const FOG_DAY = new THREE.Color(0xbfe0ea);
const FOG_NIGHT = new THREE.Color(0x0a0f1a);

// ---------- the scene ----------
export class MindForestScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_DAY.getHex(), 8, 26);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.itemIds = new Set();
    this.animated = [];
    this.clock = new THREE.Clock();
    this._running = false;
    this._raf = null;
    this.nightFactor = 0;

    this._buildStaticScene();

    this._onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _buildStaticScene() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x39331f, 0.8);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sun.position.set(4, 6, 3);
    this.scene.add(this.hemi, this.sun);

    const clearing = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshLambertMaterial({ color: 0x4a7a52, flatShading: true })
    );
    clearing.rotation.x = -Math.PI / 2;
    const outer = new THREE.Mesh(
      new THREE.CircleGeometry(11, 32),
      new THREE.MeshLambertMaterial({ color: 0x2f5233, flatShading: true })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    this.scene.add(outer, clearing);

    // a few ambient motes, always present at low opacity — no unlock required
    const moteCount = 40;
    const positions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = Math.random() * 2.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.moteMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, transparent: true, opacity: 0.35, depthWrite: false });
    this.motes = new THREE.Points(moteGeo, this.moteMat);
    this.scene.add(this.motes);
  }

  setSize(w, h) {
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setUnlockedItems(items) {
    items.forEach((item, index) => {
      if (this.itemIds.has(item.id)) return;
      this.itemIds.add(item.id);
      this._addItem(item, index);
    });
  }

  _addItem(item, index) {
    const build = BUILDERS[item.kind] || buildSapling;
    const rng = mulberry32(index * 97 + 13);
    const group = build(rng);
    const { x, z } = placementFor(index);
    group.position.x += x;
    group.position.z += z;
    this.pivot.add(group);
    if (group.userData.animate) this.animated.push(group);
    this._growIn(group);
  }

  _growIn(group) {
    const targetScale = group.scale.clone();
    group.scale.setScalar(0.001);
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      group.scale.set(
        lerp(0.001, targetScale.x, eased),
        lerp(0.001, targetScale.y, eased),
        lerp(0.001, targetScale.z, eased)
      );
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  start() {
    if (this._running) return;
    this._running = true;
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
  }

  _tick() {
    const t = this.clock.getElapsedTime();
    const angle = Math.sin(t * 0.05) * 0.4 - 0.15;
    const dist = 9.5;
    this.camera.position.set(Math.sin(angle) * dist, 5.6, Math.cos(angle) * dist);
    this.camera.lookAt(0, 1.0, 0);

    const now = new Date();
    this.nightFactor = nightFactorFor(now.getHours() + now.getMinutes() / 60);
    this.scene.background = SKY_DAY.clone().lerp(SKY_NIGHT, this.nightFactor);
    this.scene.fog.color = FOG_DAY.clone().lerp(FOG_NIGHT, this.nightFactor);
    this.hemi.intensity = lerp(0.85, 0.22, this.nightFactor);
    this.sun.intensity = lerp(0.95, 0.12, this.nightFactor);
    this.sun.color = new THREE.Color().lerpColors(new THREE.Color(0xfff3d6), new THREE.Color(0x27407a), this.nightFactor);

    this.motes.rotation.y = t * 0.01;
    this.animated.forEach((g) => g.userData.animate(t, this.nightFactor));
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
