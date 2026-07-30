// Bridges reading activity to Supabase: one row per document, one row per
// reading session, one append-only growth_events row per GP-earning moment.
// Every call here is a no-op when signed out, and failures are swallowed
// (logged, not thrown) — cloud sync is a best-effort backup/cross-device
// layer on top of the local economy in forest-state.js, never a blocker for
// using the app.

import { client, getUser } from './auth.js';

const documentIdCache = new Map(); // fileKey -> document_id, avoids a re-upsert per page turn

let active = null; // { fileKey, fileName, documentId, sessionId, pagesReadInSession, startedAtMs }

async function ensureDocument(fileKey, fileName, mode, numPages) {
  const user = getUser();
  if (!user) return null;
  if (documentIdCache.has(fileKey)) return documentIdCache.get(fileKey);
  const { data, error } = await client
    .from('documents')
    .upsert(
      { user_id: user.id, file_name: fileName, file_key: fileKey, mode, num_pages: numPages },
      { onConflict: 'user_id,file_key' }
    )
    .select('id')
    .single();
  if (error || !data) {
    console.warn('[cloud-sync] ensureDocument failed', error);
    return null;
  }
  documentIdCache.set(fileKey, data.id);
  return data.id;
}

// Call once per "opened this book" — mirrors forestState.recordSessionStart.
export async function startSession(fileKey, fileName, mode, numPages) {
  active = null;
  const user = getUser();
  if (!user) return;
  const documentId = await ensureDocument(fileKey, fileName, mode, numPages);
  if (!documentId) return;
  const { data, error } = await client
    .from('reading_sessions')
    .insert({ user_id: user.id, document_id: documentId })
    .select('id')
    .single();
  if (error || !data) {
    console.warn('[cloud-sync] startSession failed', error);
    return;
  }
  active = { fileKey, fileName, documentId, sessionId: data.id, pagesReadInSession: 0, startedAtMs: Date.now() };
}

// Call when the reader closes the book — writes the session's final tally.
export async function endSession() {
  if (!active) return;
  const { sessionId, pagesReadInSession, startedAtMs } = active;
  active = null;
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
  const { error } = await client
    .from('reading_sessions')
    .update({ ended_at: new Date().toISOString(), pages_read: pagesReadInSession, duration_seconds: durationSeconds })
    .eq('id', sessionId);
  if (error) console.warn('[cloud-sync] endSession failed', error);
}

export function trackPagesInSession(newPages) {
  if (active) active.pagesReadInSession += newPages;
}

// One row per GP-earning moment. growthType is either a source category
// ('pages' | 'milestone' | 'focus' | 'streak' | 'daily-open') or, when this
// moment also crossed an unlock threshold, the specific forest element kind.
export async function insertGrowthEvent({ growthType, growthValue, pagesRead = 0, timeSpentSeconds = 0 }) {
  const user = getUser();
  if (!user) return;
  const row = {
    user_id: user.id,
    document_id: active ? active.documentId : null,
    file_name: active ? active.fileName : null,
    session_id: active ? active.sessionId : null,
    pages_read: pagesRead,
    time_spent_seconds: timeSpentSeconds,
    growth_type: growthType,
    growth_value: growthValue,
  };
  const { error } = await client.from('growth_events').insert(row);
  if (error) console.warn('[cloud-sync] insertGrowthEvent failed', error);
}

// Cross-device catch-up: what does this account already have, from any
// device? Used once on sign-in to reconcile with (never silently discard)
// whatever progress this browser already made locally.
export async function fetchCloudTotals() {
  const user = getUser();
  if (!user) return null;
  const { data, error } = await client.rpc('get_my_totals');
  if (error || !data || !data[0]) {
    console.warn('[cloud-sync] fetchCloudTotals failed', error);
    return null;
  }
  const row = data[0];

  let streak = 0;
  let longestStreak = 0;
  try {
    const { data: sessions } = await client
      .from('reading_sessions')
      .select('started_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(120);
    if (sessions && sessions.length) {
      // most-recent-first distinct calendar days
      const days = [...new Set(sessions.map((s) => s.started_at.slice(0, 10)))].sort().reverse();
      const dayGap = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);

      let run = 1;
      longestStreak = 1;
      for (let i = 1; i < days.length; i++) {
        run = dayGap(days[i - 1], days[i]) === 1 ? run + 1 : 1;
        longestStreak = Math.max(longestStreak, run);
      }

      const today = new Date().toISOString().slice(0, 10);
      if (dayGap(today, days[0]) <= 1) {
        streak = 1;
        for (let i = 1; i < days.length && dayGap(days[i - 1], days[i]) === 1; i++) streak++;
      }
    }
  } catch (e) { /* streak reconstruction is best-effort */ }

  return {
    totalGp: Number(row.total_gp) || 0,
    totalSessions: Number(row.total_sessions) || 0,
    totalPagesTurned: Number(row.total_pages_turned) || 0,
    totalFocusMinutes: Number(row.total_focus_minutes) || 0,
    focusSessionsCompleted: Number(row.focus_sessions_completed) || 0,
    streak,
    longestStreak,
  };
}
