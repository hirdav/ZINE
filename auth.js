// Supabase Auth — Google Sign-In and cross-device session management.
//
// Reading itself needs no account: open a file and it just works, exactly
// as before. Signing in adds one thing on top — the Mind Forest's growth
// history syncs to your account instead of staying in this browser's
// localStorage, so it follows you to another device. Everything else in
// the app is oblivious to whether anyone is signed in.
//
// Loaded after vendor/supabase.umd.js, a classic (non-module) script that
// sets window.supabase — the only place that global is touched.

const SUPABASE_URL = 'https://lzwtfgsumoehpuvoncax.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zg0MAx0FHIFjHaqCdhJf_Q_mgEQqWGZ';

export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

let currentSession = null;
let ready = false;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => { try { fn(currentSession); } catch (e) { /* listener bug shouldn't break auth */ } });
}

// Fires immediately with whatever's currently known (null until the initial
// getSession() resolves), then again on every subsequent change.
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(currentSession);
  return () => listeners.delete(fn);
}

export function getSession() { return currentSession; }
export function getUser() { return currentSession ? currentSession.user : null; }
export function isSignedIn() { return !!currentSession; }

const readyPromise = client.auth.getSession().then(({ data }) => {
  currentSession = data.session;
  ready = true;
  emit();
});
export function whenReady() { return readyPromise; }
export function isReady() { return ready; }

client.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  emit();
});

export async function signInWithGoogle() {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  await client.auth.signOut();
}
