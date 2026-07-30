// The dedicated reading analytics page — the calendar heatmap, streak
// history, recent sessions, consistency/focus-score metrics, and time per
// document, all computed once by profile-data.js's loadProfileData().
import { requireAuth, mountAppNav } from './app-nav.js';
import { loadProfileData } from './profile-data.js';

(async () => {
  'use strict';

  if (!(await requireAuth())) return;
  mountAppNav(document.getElementById('appNav'), 'analytics');

  function fmtDuration(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = data.heatmapDays.map((d) => {
    const level = d.count === 0 ? 0 : d.count === 1 ? 1 : d.count <= 3 ? 2 : 3;
    return `<div class="heatmap-cell heatmap-level-${level}" title="${d.date}: ${d.count} session${d.count === 1 ? '' : 's'}"></div>`;
  }).join('');

  document.getElementById('mConsistency').textContent = `${data.consistencyPct}%`;
  document.getElementById('mAvgSession').textContent = fmtDuration(data.avgSessionSeconds);
  document.getElementById('mFocusScore').textContent = `${data.focusScorePct}%`;

  const streakList = document.getElementById('streakHistoryList');
  streakList.innerHTML = data.streakRuns.length
    ? data.streakRuns.slice(0, 8).map((r) => `
        <div class="streak-history-item">
          <span class="streak-history-len">${r.length} day${r.length === 1 ? '' : 's'}</span>
          <span class="streak-history-range">${fmtDate(r.start)} – ${fmtDate(r.end)}</span>
        </div>`).join('')
    : '<p class="analytics-card-hint">no reading streaks yet</p>';

  const sessionsList = document.getElementById('recentSessionsList');
  sessionsList.innerHTML = data.recentSessions.length
    ? data.recentSessions.map((s) => `
        <div class="recent-session-item">
          <span class="recent-session-file">${esc(s.fileName)}</span>
          <span class="recent-session-meta">${fmtDateTime(s.started_at)} · ${fmtDuration(s.duration_seconds || 0)} · ${s.pages_read || 0}p</span>
        </div>`).join('')
    : '<p class="analytics-card-hint">no sessions recorded yet</p>';

  const timePerDocList = document.getElementById('timePerDocList');
  const byTime = data.library.slice().sort((a, b) => b.readingTimeSeconds - a.readingTimeSeconds);
  const maxSeconds = Math.max(1, byTime[0] ? byTime[0].readingTimeSeconds : 1);
  timePerDocList.innerHTML = byTime.length
    ? byTime.map((d) => `
        <div class="time-per-doc-item">
          <div class="time-per-doc-row">
            <span class="time-per-doc-name">${esc(d.fileName)}</span>
            <span class="time-per-doc-time">${fmtDuration(d.readingTimeSeconds)}</span>
          </div>
          <div class="time-per-doc-bar-track"><div class="time-per-doc-bar-fill" style="width:${Math.round((d.readingTimeSeconds / maxSeconds) * 100)}%"></div></div>
        </div>`).join('')
    : '<p class="analytics-card-hint">no reading time recorded yet</p>';
})();
