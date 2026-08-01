// Queries the Supabase backend for everything the profile dashboard shows.
// One consolidated fetch (loadProfileData) rather than scattering queries
// through profile.js — the dashboard is read-only and every section reads
// from the same handful of tables, so it's cheaper and clearer to gather it
// all up front and let the rendering code just be a view over plain data.
import { client, getUser } from './auth.js';
import { UNLOCK_CATALOG, KIND_ICONS } from './forest-state.js';

const TREE_KINDS = new Set(['young-pine', 'young-oak', 'young-birch', 'mature-pine', 'mature-oak', 'mature-birch']);
const FOREST_KINDS = new Set(UNLOCK_CATALOG.map((i) => i.kind).concat([...TREE_KINDS]));

function isForestKind(growthType) {
  return FOREST_KINDS.has(growthType) || growthType in KIND_ICONS;
}

const SOURCE_LABELS = {
  'pages': 'reading session',
  'milestone': 'book milestone reached',
  'focus': 'focus session completed',
  'streak': 'streak bonus',
  'daily-open': 'opened a book',
};

export function describeGrowthEvent(ev) {
  if (isForestKind(ev.growth_type)) {
    const icon = KIND_ICONS[ev.growth_type] || '🌱';
    const label = ev.growth_type.replace(/-/g, ' ');
    return { icon, text: `unlocked: ${label}`, kind: 'unlock' };
  }
  return { icon: '📖', text: SOURCE_LABELS[ev.growth_type] || ev.growth_type, kind: 'progress' };
}

function dateKey(iso) { return iso.slice(0, 10); }
function isWeekend(iso) { const d = new Date(iso).getDay(); return d === 0 || d === 6; }
function isNight(iso) { const h = new Date(iso).getHours(); return h >= 22 || h < 5; }

export async function loadProfileData() {
  const user = getUser();
  if (!user) return null;

  const [profileRes, documentsRes, sessionsRes, eventsRes, totalsRes] = await Promise.all([
    client.from('profiles').select('*').eq('id', user.id).single(),
    client.from('documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    client.from('reading_sessions').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(500),
    client.from('growth_events').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(2000),
    client.rpc('get_my_totals'),
  ]);

  const profile = profileRes.data || null;
  const documents = documentsRes.data || [];
  const sessions = sessionsRes.data || [];
  const events = eventsRes.data || [];
  const totalsRow = totalsRes.data && totalsRes.data[0];

  const totals = {
    totalGp: Number(totalsRow && totalsRow.total_gp) || 0,
    totalSessions: Number(totalsRow && totalsRow.total_sessions) || 0,
    totalPagesTurned: Number(totalsRow && totalsRow.total_pages_turned) || 0,
    totalFocusMinutes: Number(totalsRow && totalsRow.total_focus_minutes) || 0,
    focusSessionsCompleted: Number(totalsRow && totalsRow.focus_sessions_completed) || 0,
  };

  // ---------- per-document aggregates (library cards) ----------
  const byDoc = new Map();
  documents.forEach((doc) => byDoc.set(doc.id, {
    id: doc.id,
    fileName: doc.file_name,
    mode: doc.mode,
    numPages: doc.num_pages,
    createdAt: doc.created_at,
    pagesCompleted: 0,
    readingTimeSeconds: 0,
    lastOpened: null,
    forestContribution: 0,
    sessionCount: 0,
  }));
  sessions.forEach((s) => {
    const d = byDoc.get(s.document_id);
    if (!d) return;
    d.readingTimeSeconds += s.duration_seconds || 0;
    d.sessionCount += 1;
    if (!d.lastOpened || s.started_at > d.lastOpened) d.lastOpened = s.started_at;
  });
  events.forEach((ev) => {
    const d = byDoc.get(ev.document_id);
    if (!d) return;
    d.forestContribution += Number(ev.growth_value) || 0;
    if (ev.growth_type === 'pages') d.pagesCompleted += ev.pages_read || 0;
  });
  const library = [...byDoc.values()].map((d) => ({
    ...d,
    pagesCompleted: Math.min(d.pagesCompleted, d.numPages),
    progressPct: d.numPages ? Math.min(100, Math.round((d.pagesCompleted / d.numPages) * 100)) : 0,
  })).sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''));

  // ---------- calendar heatmap (last 12 weeks of session activity) ----------
  const dayCounts = new Map(); // 'YYYY-MM-DD' -> sessions that day
  sessions.forEach((s) => {
    const k = dateKey(s.started_at);
    dayCounts.set(k, (dayCounts.get(k) || 0) + 1);
  });
  const today = new Date();
  const heatmapDays = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = dateKey(d.toISOString());
    heatmapDays.push({ date: k, count: dayCounts.get(k) || 0 });
  }

  // ---------- streak history: consecutive-day runs, most recent first ----------
  const activeDays = [...dayCounts.keys()].sort().reverse();
  const streakRuns = [];
  let run = null;
  for (let i = 0; i < activeDays.length; i++) {
    const day = activeDays[i];
    if (run && Math.round((new Date(run.start) - new Date(day)) / 86400000) === 1) {
      run.start = day;
      run.length += 1;
    } else {
      if (run) streakRuns.push(run);
      run = { start: day, end: day, length: 1 };
    }
  }
  if (run) streakRuns.push(run);

  // ---------- consistency / averages ----------
  const last30 = heatmapDays.slice(-30);
  const activeDaysLast30 = last30.filter((d) => d.count > 0).length;
  const consistencyPct = Math.round((activeDaysLast30 / 30) * 100);
  const avgSessionSeconds = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / sessions.length)
    : 0;
  const totalReadingSeconds = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
  const focusScorePct = totalReadingSeconds > 0
    ? Math.min(100, Math.round((totals.totalFocusMinutes * 60 / totalReadingSeconds) * 100))
    : 0;

  // ---------- achievements inputs ----------
  const distinctDocumentsRead = new Set(sessions.map((s) => s.document_id).filter(Boolean)).size;
  const hasTreeUnlock = events.some((ev) => TREE_KINDS.has(ev.growth_type));
  const unlockCount = events.filter((ev) => isForestKind(ev.growth_type)).length;
  const hasNightEvent = events.some((ev) => isNight(ev.created_at));
  const hasWeekendEvent = events.some((ev) => isWeekend(ev.created_at));
  let longestStreak = 0;
  streakRuns.forEach((r) => { if (r.length > longestStreak) longestStreak = r.length; });

  return {
    profile,
    user,
    totals,
    library,
    recentSessions: sessions.slice(0, 12).map((s) => ({
      ...s,
      fileName: (byDoc.get(s.document_id) || {}).fileName || s.file_name || 'untitled',
    })),
    growthTimeline: events.map((ev) => ({ ...ev, ...describeGrowthEvent(ev) })),
    heatmapDays,
    streakRuns,
    consistencyPct,
    avgSessionSeconds,
    focusScorePct,
    distinctDocumentsRead,
    hasTreeUnlock,
    unlockCount,
    hasNightEvent,
    hasWeekendEvent,
    longestStreak,
  };
}
