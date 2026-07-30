// Minimal, honest settings: only controls that actually do something.
// The default ambient volume is the same localStorage key app.js reads on
// the reader page, so a change here takes effect next time a book is
// opened — no separate "preferences" store to keep in sync.
import { requireAuth, mountAppNav } from './app-nav.js';
import * as auth from './auth.js';
import * as forestState from './forest-state.js';

const SOUND_VOL_KEY = 'zine.sound.volume';

(async () => {
  'use strict';

  const user = await requireAuth();
  if (!user) return;
  mountAppNav(document.getElementById('appNav'), 'settings');

  document.getElementById('settingsEmail').textContent = user.email || '';

  const volumeInput = document.getElementById('settingsVolume');
  const volumeLabel = document.getElementById('settingsVolumeLabel');
  let vol = 0.45;
  try {
    const raw = localStorage.getItem(SOUND_VOL_KEY);
    if (raw !== null) vol = Math.max(0, Math.min(1, parseFloat(raw)));
  } catch (e) { /* private mode etc */ }
  volumeInput.value = String(Math.round(vol * 100));
  volumeLabel.textContent = `${Math.round(vol * 100)}%`;

  volumeInput.addEventListener('input', () => {
    const pct = Number(volumeInput.value);
    volumeLabel.textContent = `${pct}%`;
    try { localStorage.setItem(SOUND_VOL_KEY, String(pct / 100)); } catch (e) { /* private mode etc */ }
  });

  document.getElementById('replayOnboardingBtn').addEventListener('click', (e) => {
    forestState.resetOnboarding();
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = 'will replay next visit ✓';
    setTimeout(() => { btn.textContent = original; }, 2200);
  });

  document.getElementById('settingsSignOutBtn').addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = 'index.html';
  });
})();
