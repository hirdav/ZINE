// Mind Forest progression engine.
//
// A small offline economy: reading pages, crossing book milestones, keeping
// a daily streak, and completing focus sessions all earn Growth Points (GP).
// GP never get spent — they are a lifetime total that unlocks an ever-growing
// catalog of forest elements (trees, plants, wildlife, environmental detail).
// Everything is persisted to localStorage; there is no backend and no
// account, so progress lives on this device only (same model as the sound
// and library preferences elsewhere in the app).
//
// This module owns the economy and persistence only. forest-scene.js turns
// the unlocked catalog into a living scene (and lets the reader drag items
// around it — custom layout lives here too, in itemPositions); celebrate.js
// turns emitted events into on-screen moments; app.js / pomodoro.js call the
// record* functions at the right lifecycle points.
//
// localStorage stays the source of truth for the live session — it's
// synchronous and never blocks reading. Signing in adds cloud-sync.js on
// top: every GP-earning moment is also pushed to Supabase as an
// append-only growth_event (best-effort, fire-and-forget), and
// reconcileFromCloud() catches this device up with whatever an account
// already has from reading elsewhere.

import * as cloudSync from './cloud-sync.js';

const STORAGE_KEY = 'zine.forest.v1';

// ---------- tiny event emitter ----------
const listeners = new Set();
function emit(event) {
  listeners.forEach((fn) => { try { fn(event); } catch (e) { /* listener bug shouldn't break the app */ } });
}
export function onForestEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- date helpers (local calendar days) ----------
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------- seasons (real calendar month; purely a visual mood, no data cost) ----------
export function getSeason(d = new Date()) {
  const m = d.getMonth(); // 0=Jan
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

// ---------- unlock catalog ----------
// Order = unlock order. `gp` is the lifetime-GP threshold at which the item
// appears. Kinds are consumed by forest-scene.js's per-kind builders.
export const UNLOCK_CATALOG = [
  { id: 'sprout-1', gp: 0, kind: 'sprout', label: 'First Sprout' },
  { id: 'sapling-1', gp: 15, kind: 'sapling', label: 'Sapling' },
  { id: 'fern-1', gp: 35, kind: 'fern', label: 'Fern' },
  { id: 'pine-young-1', gp: 60, kind: 'young-pine', label: 'Young Pine' },
  { id: 'mushrooms-1', gp: 90, kind: 'mushroom-cluster', label: 'Mushroom Cluster' },
  { id: 'oak-young-1', gp: 130, kind: 'young-oak', label: 'Young Oak' },
  { id: 'songbird-1', gp: 180, kind: 'songbird', label: 'Songbird' },
  { id: 'wildflowers-1', gp: 240, kind: 'wildflowers', label: 'Wildflowers' },
  { id: 'birch-young-1', gp: 310, kind: 'young-birch', label: 'Young Birch' },
  { id: 'butterfly-1', gp: 390, kind: 'butterfly', label: 'Butterfly' },
  { id: 'pine-mature-1', gp: 480, kind: 'mature-pine', label: 'Mature Pine' },
  { id: 'boulder-1', gp: 580, kind: 'boulder', label: 'Mossy Boulder' },
  { id: 'log-1', gp: 700, kind: 'fallen-log', label: 'Fallen Log' },
  { id: 'oak-mature-1', gp: 830, kind: 'mature-oak', label: 'Mature Oak' },
  { id: 'fireflies-1', gp: 970, kind: 'firefly-swarm', label: 'Firefly Swarm' },
  { id: 'pond-1', gp: 1130, kind: 'pond', label: 'Still Pond' },
  { id: 'birch-mature-1', gp: 1300, kind: 'mature-birch', label: 'Mature Birch' },
  { id: 'deer-1', gp: 1500, kind: 'deer', label: 'Deer' },
  { id: 'fox-1', gp: 1720, kind: 'fox', label: 'Fox' },
  { id: 'canopy-1', gp: 1960, kind: 'starlit-canopy', label: 'Starlit Canopy' },
];

// after the catalog is exhausted the forest keeps growing indefinitely —
// one more tree every EXTENDED_STEP GP, cycling through mature species
const EXTENDED_STEP = 250;
const EXTENDED_KINDS = ['mature-pine', 'mature-oak', 'mature-birch', 'young-pine', 'young-oak', 'young-birch'];

function unlockAtIndex(i) {
  if (i < UNLOCK_CATALOG.length) return UNLOCK_CATALOG[i];
  const extra = i - UNLOCK_CATALOG.length;
  const gp = UNLOCK_CATALOG[UNLOCK_CATALOG.length - 1].gp + EXTENDED_STEP * (extra + 1);
  const kind = EXTENDED_KINDS[extra % EXTENDED_KINDS.length];
  return { id: `grove-${extra + 1}`, gp, kind, label: 'Grove Tree' };
}

function unlockedCountForGP(gp) {
  let i = 0;
  while (i < 5000 && unlockAtIndex(i).gp <= gp) i++;
  return i;
}

// ---------- state ----------
const DEFAULT_STATE = {
  gp: 0,
  streak: 0,
  longestStreak: 0,
  lastActiveDate: null,
  totalSessions: 0,
  totalPagesTurned: 0,
  totalFocusMinutes: 0,
  focusSessionsCompleted: 0,
  booksProgress: {},
  unlockedIds: [],
  unlockRecords: {}, // id -> { unlockedAt, streak, totalSessions, totalFocusMinutes, gp }
  itemPositions: {}, // id -> { x, y } — set once the reader drags an item off its default spot
  onboardingSeen: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE, booksProgress: {}, unlockedIds: [], unlockRecords: {}, itemPositions: {} };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      booksProgress: parsed.booksProgress || {},
      unlockedIds: parsed.unlockedIds || [],
      unlockRecords: parsed.unlockRecords || {},
      itemPositions: parsed.itemPositions || {},
    };
  } catch (e) {
    return { ...DEFAULT_STATE, booksProgress: {}, unlockedIds: [], unlockRecords: {}, itemPositions: {} };
  }
}

let state = load();
checkUnlocks(); // a fresh forest starts with its 0-GP unlocks (first sprout) already there
save();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc */ }
}

function checkUnlocks() {
  const target = unlockedCountForGP(state.gp);
  while (state.unlockedIds.length < target) {
    const index = state.unlockedIds.length;
    const item = unlockAtIndex(index);
    state.unlockedIds.push(item.id);
    state.unlockRecords[item.id] = {
      unlockedAt: Date.now(),
      streak: state.streak,
      totalSessions: state.totalSessions,
      totalFocusMinutes: state.totalFocusMinutes,
      gp: state.gp,
    };
    emit({ type: 'unlock', item, index });
    // marker event, not a GP-earning one — growth_value 0 flags "this GP
    // total crossed a threshold" without double-counting the GP itself
    cloudSync.insertGrowthEvent({ growthType: item.kind, growthValue: 0 }).catch(() => {});
  }
}

function addGP(amount, reason, meta = {}) {
  if (amount <= 0) return;
  state.gp += amount;
  checkUnlocks();
  save();
  cloudSync.insertGrowthEvent({
    growthType: reason,
    growthValue: amount,
    pagesRead: meta.pagesRead || 0,
    timeSpentSeconds: meta.timeSpentSeconds || 0,
  }).catch(() => {});
}

// ---------- public: recording activity ----------

// Call once each time a book/library item is opened (a "reading session").
export function recordSessionStart(bookKey, fileName, mode, numPages) {
  const today = todayStr();
  state.totalSessions += 1;
  if (state.lastActiveDate !== today) {
    const wasYesterday = state.lastActiveDate && daysBetween(state.lastActiveDate, today) === 1;
    state.streak = wasYesterday ? state.streak + 1 : 1;
    state.longestStreak = Math.max(state.longestStreak, state.streak);
    state.lastActiveDate = today;
    addGP(5, 'daily-open');
    addGP(Math.min(state.streak, 14) * 2, 'streak');
    save();
    emit({ type: 'streak', streak: state.streak, longestStreak: state.longestStreak });
  } else {
    save();
  }
  if (bookKey && fileName && numPages) {
    cloudSync.startSession(bookKey, fileName, mode, numPages).catch(() => {});
  }
}

// Call when the reader closes the current book — writes the cloud session's
// final tally. No-op locally; localStorage progress is already saved
// incrementally by recordPageProgress.
export function recordSessionEnd() {
  cloudSync.endSession().catch(() => {});
}

// Call whenever the furthest page reached in a book may have advanced.
// bookKey should be stable across reopens of the same book (name+size works
// well enough without hashing file contents).
export function recordPageProgress(bookKey, pageReached, numPages) {
  if (!bookKey || !numPages) return;
  const bp = state.booksProgress[bookKey] || (state.booksProgress[bookKey] = { maxPage: 0, numPages, milestones: {} });
  bp.numPages = numPages;
  if (pageReached <= bp.maxPage) return;

  const newPages = pageReached - bp.maxPage;
  bp.maxPage = pageReached;
  state.totalPagesTurned += newPages;
  cloudSync.trackPagesInSession(newPages);
  addGP(newPages, 'pages', { pagesRead: newPages });

  [25, 50, 75, 100].forEach((pct) => {
    if (!bp.milestones[pct] && (bp.maxPage / bp.numPages) * 100 >= pct) {
      bp.milestones[pct] = true;
      addGP(12, 'milestone');
      emit({ type: 'milestone', pct, bookKey });
    }
  });
  save();
}

// Call when a Pomodoro focus session completes (not on cancel).
export function recordFocusSessionComplete(minutes) {
  state.totalFocusMinutes += minutes;
  state.focusSessionsCompleted += 1;
  addGP(18, 'focus', { timeSpentSeconds: Math.round(minutes * 60) });
  save();
  emit({ type: 'focus-complete', minutes, totalFocusMinutes: state.totalFocusMinutes });
}

// Cross-device catch-up, called once after sign-in resolves. Takes the max
// of every counter (never regresses a device that's ahead), then silently
// re-derives unlocks up to the merged GP total — no celebration toasts, since
// these weren't just earned, they're being caught up on.
export function reconcileFromCloud(totals) {
  if (!totals) return;
  state.gp = Math.max(state.gp, totals.totalGp);
  state.totalSessions = Math.max(state.totalSessions, totals.totalSessions);
  state.totalPagesTurned = Math.max(state.totalPagesTurned, totals.totalPagesTurned);
  state.totalFocusMinutes = Math.max(state.totalFocusMinutes, totals.totalFocusMinutes);
  state.focusSessionsCompleted = Math.max(state.focusSessionsCompleted, totals.focusSessionsCompleted);
  state.streak = Math.max(state.streak, totals.streak);
  state.longestStreak = Math.max(state.longestStreak, totals.longestStreak);

  const target = unlockedCountForGP(state.gp);
  while (state.unlockedIds.length < target) {
    const index = state.unlockedIds.length;
    const item = unlockAtIndex(index);
    state.unlockedIds.push(item.id);
    state.unlockRecords[item.id] = state.unlockRecords[item.id] || {
      unlockedAt: Date.now(),
      streak: state.streak,
      totalSessions: state.totalSessions,
      totalFocusMinutes: state.totalFocusMinutes,
      gp: state.gp,
    };
  }
  save();
  emit({ type: 'reconciled' });
}

export function markOnboardingSeen() {
  state.onboardingSeen = true;
  save();
}
export function hasSeenOnboarding() {
  return !!state.onboardingSeen;
}

// ---------- public: reading state ----------

export function getUnlockedItems() {
  return state.unlockedIds.map((id, i) => unlockAtIndex(i));
}

// The story behind one grown item — when it appeared and what your reading
// habit looked like that day. Falls back gracefully for items unlocked
// before this record existed.
export function getUnlockRecord(id) {
  return state.unlockRecords[id] || null;
}

export function getItemPosition(id) {
  return state.itemPositions[id] || null;
}

// Persist a custom (dragged) position for an item, in the scene's own world
// coordinates — independent of pan/zoom so it's stable across sessions.
export function setItemPosition(id, x, y) {
  state.itemPositions[id] = { x, y };
  save();
}

export function clearItemPosition(id) {
  delete state.itemPositions[id];
  save();
}

export function getProgress() {
  const idx = state.unlockedIds.length;
  const next = unlockAtIndex(idx);
  const prevGp = idx === 0 ? 0 : unlockAtIndex(idx - 1).gp;
  const span = Math.max(1, next.gp - prevGp);
  const into = clamp(state.gp - prevGp, 0, span);
  return {
    gp: state.gp,
    nextLabel: next.label,
    nextKind: next.kind,
    pct: into / span,
    remaining: Math.max(0, next.gp - state.gp),
  };
}

export function getStats() {
  return {
    gp: state.gp,
    streak: state.streak,
    longestStreak: state.longestStreak,
    totalSessions: state.totalSessions,
    totalPagesTurned: state.totalPagesTurned,
    totalFocusMinutes: state.totalFocusMinutes,
    focusSessionsCompleted: state.focusSessionsCompleted,
    unlockedCount: state.unlockedIds.length,
  };
}

export function bookKeyFor(name, numPages) {
  return `${name}::${numPages}`;
}

// shared between celebrate.js (toasts) and forest-scene.js (tap-to-inspect popover)
export const KIND_ICONS = {
  sprout: '🌱', sapling: '🌿', fern: '🌿', 'young-pine': '🌲', 'mushroom-cluster': '🍄',
  'young-oak': '🌳', songbird: '🐦', wildflowers: '🌼', 'young-birch': '🌳', butterfly: '🦋',
  'mature-pine': '🌲', boulder: '🪨', 'fallen-log': '🪵', 'mature-oak': '🌳', 'firefly-swarm': '✨',
  pond: '💧', 'mature-birch': '🌳', deer: '🦌', fox: '🦊', 'starlit-canopy': '✨', grove: '🌳',
};

// kinds that roam under their own animation rather than being "planted" —
// selectable for their story, but not draggable to a new spot
export const MOBILE_KINDS = new Set(['songbird', 'butterfly']);
