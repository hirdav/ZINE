// Achievement catalog for the profile dashboard. Each entry's `check` reads
// only real, already-tracked numbers (from profile-data.js's aggregate query
// or forest-state.js's local stats) — nothing here invents progress that
// wasn't actually earned.

export const ACHIEVEMENTS = [
  {
    id: 'first-session',
    icon: '📖',
    label: 'First Reading Session',
    hint: 'Open your first book.',
    check: (d) => d.totals.totalSessions >= 1,
  },
  {
    id: 'seven-day-streak',
    icon: '🔥',
    label: 'Seven-Day Streak',
    hint: 'Read on seven days in a row.',
    check: (d) => d.longestStreak >= 7,
  },
  {
    id: 'ten-hours-focused',
    icon: '⏱',
    label: '10 Hours Focused',
    hint: 'Complete 10 hours of Pomodoro focus sessions.',
    check: (d) => d.totals.totalFocusMinutes >= 600,
  },
  {
    id: 'first-tree',
    icon: '🌲',
    label: 'First Tree',
    hint: 'Grow your first tree (pine, oak, or birch).',
    check: (d) => d.hasTreeUnlock,
  },
  {
    id: 'first-forest',
    icon: '🌳',
    label: 'First Forest',
    hint: 'Unlock 10 forest elements.',
    check: (d) => d.unlockCount >= 10,
  },
  {
    id: 'thousand-pages',
    icon: '📚',
    label: '1,000 Pages Read',
    hint: 'Turn 1,000 pages, lifetime.',
    check: (d) => d.totals.totalPagesTurned >= 1000,
  },
  {
    id: 'night-reader',
    icon: '🌙',
    label: 'Night Reader',
    hint: 'Grow something between 10pm and 5am.',
    check: (d) => d.hasNightEvent,
  },
  {
    id: 'weekend-reader',
    icon: '🛋',
    label: 'Weekend Reader',
    hint: 'Grow something on a Saturday or Sunday.',
    check: (d) => d.hasWeekendEvent,
  },
  {
    id: 'knowledge-explorer',
    icon: '🧭',
    label: 'Knowledge Explorer',
    hint: 'Read from 3 or more different documents.',
    check: (d) => d.distinctDocumentsRead >= 3,
  },
];

// Runs every check against the profile data bundle, returning the catalog
// annotated with { unlocked }. Pure and synchronous — profile.js decides
// what to do with the result (render + diff against localStorage to decide
// what's "new" this visit).
export function computeAchievements(profileData) {
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: !!a.check(profileData) }));
}

const SEEN_KEY = 'zine.achievements.seen.v1';

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (e) { /* private mode etc */ }
}

// Marks which unlocked achievements haven't been shown as "new" before, then
// remembers them as seen — so a newly-crossed achievement animates once on
// the visit it's earned, and reads as already-unlocked (no animation) after.
export function markNewlySeen(achievements) {
  const seen = loadSeen();
  const withNew = achievements.map((a) => ({ ...a, isNew: a.unlocked && !seen.has(a.id) }));
  withNew.forEach((a) => { if (a.unlocked) seen.add(a.id); });
  saveSeen(seen);
  return withNew;
}
