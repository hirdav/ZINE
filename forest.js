// The dedicated Mind Forest page: the same embedded, explorable scene that
// used to live inside profile.js's forest section, just given a full page
// and more room to breathe. Filtering by document/date only affects the
// side list (which growth events matched) — the scene itself always shows
// the complete, real forest; see profile-data.js's growthTimeline for why
// growth events (not the scene) are what's filterable.
import { requireAuth, mountAppNav } from './app-nav.js';
import { loadProfileData } from './profile-data.js';
import * as forestState from './forest-state.js';
import { MindForestScene } from './forest-scene.js';

(async () => {
  'use strict';

  if (!(await requireAuth())) return;
  mountAppNav(document.getElementById('appNav'), 'forest');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const slot = document.getElementById('profileForestCanvasSlot');
  const scene = new MindForestScene();
  slot.appendChild(scene.el);
  scene.setUnlockedItems(forestState.getUnlockedItems());
  const resize = () => { const r = slot.getBoundingClientRect(); scene.setSize(r.width, r.height); };
  requestAnimationFrame(resize);
  window.addEventListener('resize', resize);
  scene.start();

  const data = await loadProfileData();
  if (!data) return;

  const docSelect = document.getElementById('forestFilterDoc');
  data.library.forEach((doc) => {
    const opt = document.createElement('option');
    opt.value = doc.id;
    opt.textContent = doc.fileName;
    docSelect.appendChild(opt);
  });

  const rangeSelect = document.getElementById('forestFilterRange');
  const listEl = document.getElementById('forestFilterList');

  function applyFilter() {
    const docId = docSelect.value;
    const rangeDays = rangeSelect.value === 'all' ? null : Number(rangeSelect.value);
    const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : null;
    const matches = data.growthTimeline.filter((ev) => {
      if (ev.kind !== 'unlock') return false;
      if (docId && ev.document_id !== docId) return false;
      if (cutoff && new Date(ev.created_at).getTime() < cutoff) return false;
      return true;
    });
    listEl.innerHTML = matches.length
      ? matches.map((ev) => `
          <div class="forest-filter-item">
            <span class="forest-filter-icon">${ev.icon}</span>
            <div>
              <div class="forest-filter-label">${esc(ev.text)}</div>
              <div class="forest-filter-meta">${esc(ev.file_name || 'unattributed')} · ${fmtDate(ev.created_at)}</div>
            </div>
          </div>`).join('')
      : '<p class="forest-filter-empty">no growth in this range yet</p>';
  }
  docSelect.addEventListener('change', applyFilter);
  rangeSelect.addEventListener('change', applyFilter);
  applyFilter();
})();
