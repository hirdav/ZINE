// The authenticated home screen. Answers, in order: what have I
// accomplished, how's my forest doing today, what's my streak, what should
// I read next, and how do I get back into a book or start focusing —
// rather than a second landing page, this is meant to feel like walking
// into a workspace that already knows where you left off.
import { requireAuth, mountAppNav } from './app-nav.js';
import { loadProfileData, describeGrowthEvent } from './profile-data.js';
import { scanLibrary } from './library.js';
import * as forestState from './forest-state.js';
import { MindForestScene } from './forest-scene.js';

(async () => {
  'use strict';

  const user = await requireAuth();
  if (!user) return;
  mountAppNav(document.getElementById('appNav'), 'dashboard');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function todayKey() { return new Date().toISOString().slice(0, 10); }

  // ---------- header ----------
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || user.email || 'reader';
  const firstName = name.split(' ')[0];
  document.getElementById('dashGreeting').textContent = `welcome back, ${firstName}`;
  const avatarUrl = meta.avatar_url || '';
  const dashAvatar = document.getElementById('dashAvatar');
  if (avatarUrl) dashAvatar.src = avatarUrl; else dashAvatar.style.visibility = 'hidden';

  const localStats = forestState.getStats();
  document.getElementById('dashStreak').textContent = String(localStats.streak);
  document.querySelector('.dash-streak-badge').classList.toggle('lit', localStats.streak > 0);
  document.getElementById('dashSub').textContent = localStats.streak > 0
    ? `you're on a ${localStats.streak}-day streak — keep it going`
    : `start today's session to begin a streak`;

  // ---------- Mind Forest, today ----------
  const forestSlot = document.getElementById('dashForestSlot');
  const scene = new MindForestScene();
  forestSlot.appendChild(scene.el);
  scene.setUnlockedItems(forestState.getUnlockedItems());
  const resize = () => { const r = forestSlot.getBoundingClientRect(); scene.setSize(r.width, r.height); };
  requestAnimationFrame(resize);
  window.addEventListener('resize', resize);
  scene.start();

  const progress = forestState.getProgress();
  document.getElementById('dashForestNext').textContent = `${progress.nextLabel} in ${progress.remaining} gp`;

  // ---------- cloud-backed sections (accomplishments, stats, continue reading) ----------
  const data = await loadProfileData();
  if (data) {
    document.getElementById('dStatBooks').textContent = String(data.library.length);
    document.getElementById('dStatPages').textContent = String(data.totals.totalPagesTurned);
    document.getElementById('dStatForestLevel').textContent = String(data.unlockCount);
    document.getElementById('dStatXp').textContent = String(data.totals.totalGp);

    const todayEvents = data.growthTimeline.filter((ev) => ev.created_at.slice(0, 10) === todayKey());
    const todayGp = Math.round(todayEvents.reduce((sum, ev) => sum + (Number(ev.growth_value) || 0), 0));
    if (todayGp > 0) {
      const footer = document.querySelector('.dash-forest-footer');
      const badge = document.createElement('span');
      badge.className = 'dash-forest-today-badge';
      badge.textContent = `+${todayGp} gp today`;
      footer.prepend(badge);
    }

    // ---------- continue reading ----------
    if (data.library.length) {
      const mostRecent = data.library[0]; // already sorted by lastOpened desc
      document.getElementById('continueContent').innerHTML = `
        <div class="dash-continue-book">
          <span class="profile-library-icon">${mostRecent.mode === 'pdf' ? '📕' : '📄'}</span>
          <div>
            <div class="dash-continue-title">${esc(mostRecent.fileName)}</div>
            <div class="dash-continue-meta">${mostRecent.progressPct}% · last opened ${fmtDate(mostRecent.lastOpened)}</div>
          </div>
        </div>
        <div class="profile-library-progress-track"><div class="profile-library-progress-fill" style="width:${mostRecent.progressPct}%"></div></div>
        <a href="library.html#resume=${encodeURIComponent(mostRecent.fileName)}" class="btn-primary dash-card-btn">continue reading</a>
      `;
    }

    // ---------- recent accomplishments ----------
    if (data.growthTimeline.length) {
      document.getElementById('accomplishList').innerHTML = data.growthTimeline.slice(0, 5).map((ev) => `
        <div class="dash-accomplish-item">
          <span class="timeline-icon">${ev.icon}</span>
          <div>
            <div class="timeline-text">${esc(ev.text)}</div>
            <div class="timeline-meta">${fmtDate(ev.created_at)}</div>
          </div>
        </div>
      `).join('');
    }

    // ---------- what to read next ----------
    const scanned = await scanLibrary().catch(() => null);
    if (scanned && scanned.length) {
      const openedNames = new Set(data.library.map((d) => d.fileName));
      const unopened = scanned.filter((item) => !openedNames.has(item.name));
      const pick = unopened[0] || scanned[Math.floor(Math.random() * scanned.length)];
      if (pick) {
        document.getElementById('nextReadContent').innerHTML = `
          <div class="dash-continue-book">
            <span class="profile-library-icon">${pick.ext === 'pdf' ? '📕' : '📄'}</span>
            <div>
              <div class="dash-continue-title">${esc(pick.title)}</div>
              <div class="dash-continue-meta">${unopened.length ? 'new — not started yet' : 'from your library'}</div>
            </div>
          </div>
          <a href="library.html#resume=${encodeURIComponent(pick.name)}" class="btn-primary dash-card-btn">open it</a>
        `;
      }
    }
  }
})();
