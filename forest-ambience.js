// The Mind Forest's own ambient soundscape (wind, rustling leaves, distant
// wildlife) — separate from the reader's ambient-sound picker, but built on
// the same soundEngine so volume/autoplay-policy handling isn't duplicated.
// Two call sites share this: the dedicated forest.html page, and the
// reader's "explore your forest" overlay.
import { soundEngine } from './sound.js';

const FOREST_SOUND_ID = 'forest';
const MUTE_KEY = 'zine.forestAmbience.muted';

export function isForestAmbienceMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
}

function persistMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* private mode etc */ }
}

// Call once when a forest view opens. A no-op when muted, and a no-op if
// the shared soundEngine is already playing something else — opening the
// forest while reading with rain on shouldn't yank that away, it should
// just leave it be.
export function startForestAmbience() {
  if (isForestAmbienceMuted()) return;
  if (soundEngine.currentId && soundEngine.currentId !== FOREST_SOUND_ID) return;
  soundEngine.play(FOREST_SOUND_ID);
}

// Call when the forest view closes/hides, so the loop doesn't keep playing
// once nobody's looking at the forest.
export function stopForestAmbience() {
  if (soundEngine.currentId === FOREST_SOUND_ID) soundEngine.stop();
}

// Flips the persisted mute preference and starts/stops playback to match.
// Returns whether the ambience is playing after the toggle.
export function toggleForestAmbience() {
  const muted = !isForestAmbienceMuted();
  persistMuted(muted);
  if (muted) stopForestAmbience(); else startForestAmbience();
  return !muted;
}
