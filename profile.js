// The profile page: identity, lifetime stats, library, growth timeline, and
// achievements. The Mind Forest explorer and reading analytics used to live
// here too — they're big enough now to be their own pages (forest.html,
// analytics.html), so this one stays focused on "who you are and what
// you've built" rather than trying to be the whole dashboard.
import { requireAuth, mountAppNav } from './app-nav.js';
import { loadProfileData } from './profile-data.js';
import { computeAchievements, markNewlySeen } from './achievements.js';
import * as forestState from './forest-state.js';

(async () => {
  'use strict';

  if (!(await requireAuth())) return;
  mountAppNav(document.getElementById('appNav'), 'profile');

  // ---------- formatting helpers ----------
  function fmtHours(minutes) {
    const h = minutes / 60;
    return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
  }
  function fmtDuration(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return `${fmtDate(iso)} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const data = await loadProfileData();
  if (!data) return;

  renderHeader(data);
  renderStats(data);
  renderLibrary(data);
  renderTimeline(data);
  renderAchievements(data);

  // ---------- header + overview ----------
  function renderHeader(data) {
    const meta = data.user.user_metadata || {};
    const name = (data.profile && data.profile.display_name) || meta.full_name || meta.name || data.user.email || 'reader';
    const avatarUrl = (data.profile && data.profile.avatar_url) || meta.avatar_url || '';
    const img = document.getElementById('pHeroAvatar');
    if (avatarUrl) img.src = avatarUrl; else img.style.visibility = 'hidden';
    document.getElementById('pHeroName').textContent = name;

    const totalBooks = data.library.length;
    document.getElementById('pHeroSub').textContent = totalBooks
      ? `${totalBooks} document${totalBooks === 1 ? '' : 's'} read · ${data.totals.totalPagesTurned} pages turned`
      : 'building a Mind Forest, one page at a time';
  }

  function renderStats(data) {
    const local = forestState.getStats();
    const level = Math.floor(data.totals.totalGp / 100) + 1;
    document.getElementById('sStreak').textContent = String(Math.max(local.streak, 0));
    document.getElementById('sBooks').textContent = String(data.library.length);
    document.getElementById('sPages').textContent = String(data.totals.totalPagesTurned);
    document.getElementById('sTime').textContent = fmtHours(data.library.reduce((sum, d) => sum + d.readingTimeSeconds, 0) / 60);
    document.getElementById('sLevel').textContent = String(level);
    document.getElementById('sForestLevel').textContent = String(data.unlockCount);
    document.getElementById('sFocusSessions').textContent = String(data.totals.focusSessionsCompleted);
    document.getElementById('sXp').textContent = String(data.totals.totalGp);
  }

  // ---------- Library ----------
  function renderLibrary(data) {
    const grid = document.getElementById('profileLibraryGrid');
    const empty = document.getElementById('profileLibraryEmpty');
    if (!data.library.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = data.library.map((d) => `
      <div class="profile-library-card">
        <div class="profile-library-card-header">
          <span class="profile-library-icon">${d.mode === 'pdf' ? '📕' : '📄'}</span>
          <span class="profile-library-title">${esc(d.fileName)}</span>
        </div>
        <div class="profile-library-progress-track"><div class="profile-library-progress-fill" style="width:${d.progressPct}%"></div></div>
        <div class="profile-library-stats">
          <span>${d.progressPct}% · ${d.pagesCompleted}/${d.numPages}p</span>
          <span>${fmtDuration(d.readingTimeSeconds)}</span>
        </div>
        <div class="profile-library-stats">
          <span>last opened ${fmtDate(d.lastOpened)}</span>
          <span>+${Math.round(d.forestContribution)} gp</span>
        </div>
        <div class="profile-library-stats profile-library-stats-muted">
          <span>0 notes</span>
          <span>0 highlights</span>
        </div>
      </div>
    `).join('');
  }

  // ---------- Growth Timeline ----------
  function renderTimeline(data) {
    const el = document.getElementById('growthTimelineList');
    el.innerHTML = data.growthTimeline.length
      ? data.growthTimeline.map((ev) => `
          <div class="timeline-item timeline-${ev.kind}">
            <span class="timeline-icon">${ev.icon}</span>
            <div class="timeline-body">
              <div class="timeline-text">${esc(ev.text)}${ev.growth_value > 0 ? ` <span class="timeline-gp">+${Math.round(ev.growth_value)} gp</span>` : ''}</div>
              <div class="timeline-meta">${esc(ev.file_name || '')}${ev.file_name ? ' · ' : ''}${fmtDateTime(ev.created_at)}</div>
            </div>
          </div>`).join('')
      : '<p class="analytics-card-hint">your growth timeline starts with your next reading session</p>';
  }

  // ---------- Achievements ----------
  function renderAchievements(data) {
    const withSeen = markNewlySeen(computeAchievements(data));
    const grid = document.getElementById('achievementsGrid');
    grid.innerHTML = withSeen.map((a) => `
      <div class="achievement-card ${a.unlocked ? 'unlocked' : 'locked'} ${a.isNew ? 'achievement-new' : ''}" data-id="${a.id}">
        <span class="achievement-icon">${a.unlocked ? a.icon : '🔒'}</span>
        <div class="achievement-label">${esc(a.label)}</div>
        <div class="achievement-hint">${esc(a.hint)}</div>
      </div>
    `).join('');

    const newlyUnlocked = withSeen.filter((a) => a.isNew);
    if (newlyUnlocked.length) queueAchievementToasts(newlyUnlocked);
  }

  function queueAchievementToasts(achievements) {
    const toastEl = document.getElementById('achievementToast');
    let i = 0;
    function showNext() {
      if (i >= achievements.length) return;
      const a = achievements[i++];
      toastEl.innerHTML = `<span class="achievement-toast-icon">${a.icon}</span><div><div class="achievement-toast-title">achievement unlocked</div><div class="achievement-toast-label">${esc(a.label)}</div></div>`;
      toastEl.classList.remove('hidden');
      void toastEl.offsetWidth;
      toastEl.classList.add('show');
      setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => { toastEl.classList.add('hidden'); showNext(); }, 400);
      }, 3200);
    }
    showNext();
  }
})();
