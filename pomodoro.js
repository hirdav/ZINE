// Pomodoro focus timer — lives inside the reader, not beside it. A completed
// focus phase feeds Growth Points into the Mind Forest via forest-state
// (recordFocusSessionComplete), so finishing a focus block *is* forest
// growth rather than a separate productivity chore.
//
// Time is tracked with wall-clock end timestamps rather than a decrementing
// counter, so a backgrounded/throttled tab still reports the correct
// remaining time whenever it's checked.

import { recordFocusSessionComplete } from './forest-state.js';

const STORAGE_KEY = 'zine.pomodoro.v1';

const DEFAULT_SETTINGS = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

const listeners = new Set();
function emit(event) {
  listeners.forEach((fn) => { try { fn(event); } catch (e) {} });
}
export function onPomodoroEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function durationMs(mode, settings) {
  const min = mode === 'focus' ? settings.focusMin : mode === 'long-break' ? settings.longMin : settings.shortMin;
  return min * 60 * 1000;
}

function load() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  const settings = { ...DEFAULT_SETTINGS, ...(saved && saved.settings) };
  const s = {
    mode: (saved && saved.mode) || 'focus',
    running: false, // never resume "running" across a reload — always land paused
    endAt: null,
    remainingMs: (saved && typeof saved.remainingMs === 'number') ? saved.remainingMs : durationMs('focus', settings),
    cyclesCompleted: (saved && saved.cyclesCompleted) || 0,
    settings,
  };
  return s;
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      remainingMs: getRemainingMs(),
      cyclesCompleted: state.cyclesCompleted,
      settings: state.settings,
    }));
  } catch (e) { /* ignore */ }
}

export function getRemainingMs() {
  if (state.running && state.endAt) return Math.max(0, state.endAt - Date.now());
  return state.remainingMs;
}

export function getMode() { return state.mode; }
export function isRunning() { return state.running; }
export function getCyclesCompleted() { return state.cyclesCompleted; }
export function getSettings() { return { ...state.settings }; }

export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function start() {
  if (state.running) return;
  if (state.remainingMs <= 0) state.remainingMs = durationMs(state.mode, state.settings);
  state.endAt = Date.now() + state.remainingMs;
  state.running = true;
  save();
  emit({ type: 'start', mode: state.mode });
}

export function pause() {
  if (!state.running) return;
  state.remainingMs = Math.max(0, state.endAt - Date.now());
  state.running = false;
  state.endAt = null;
  save();
  emit({ type: 'pause', mode: state.mode });
}

export function reset() {
  state.running = false;
  state.endAt = null;
  state.remainingMs = durationMs(state.mode, state.settings);
  save();
  emit({ type: 'reset', mode: state.mode });
}

function nextModeAfterFocus() {
  const isLong = state.cyclesCompleted > 0 && state.cyclesCompleted % state.settings.longEvery === 0;
  return isLong ? 'long-break' : 'short-break';
}

function switchMode(nextMode, autoStart) {
  const from = state.mode;
  state.mode = nextMode;
  state.remainingMs = durationMs(nextMode, state.settings);
  state.running = false;
  state.endAt = null;
  if (autoStart) start();
  save();
  emit({ type: 'phase-complete', from, to: nextMode });
}

// skip the current phase without waiting for it to finish (no reward for
// skipping a focus phase early — only a completed focus phase awards GP)
export function skip() {
  if (state.mode === 'focus') {
    switchMode(nextModeAfterFocus(), true);
  } else {
    switchMode('focus', false);
  }
}

function completeCurrentPhase() {
  if (state.mode === 'focus') {
    state.cyclesCompleted += 1;
    recordFocusSessionComplete(state.settings.focusMin);
    switchMode(nextModeAfterFocus(), true); // breaks start automatically — the point is to actually rest
  } else {
    switchMode('focus', false); // wait for a deliberate click back into focus
  }
}

function checkCompletion() {
  if (state.running && getRemainingMs() <= 0) completeCurrentPhase();
}

setInterval(checkCompletion, 500);
