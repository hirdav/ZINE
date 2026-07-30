# zine reader

A calm, focused reading workspace for PDF and plain-text zines — built around a page-by-page layout instead of infinite scroll, a Pomodoro timer designed for reading, procedural ambient sound, and a Mind Forest that grows with every session. No build step, no bundler, no framework: vanilla HTML/CSS/JS, backed by Supabase for accounts and cross-device sync.

Turn pages the way you'd turn a real one: drag a page from its edge, or just hover your cursor (or trackpad) near the edge and sweep across.

## Two experiences, kept deliberately separate

- **`index.html`** is a pure marketing page — hero, product story, live demos of the forest/Pomodoro/ambient sound, "why zine reading works," a FAQ, and a sign-in CTA. No file upload, no library, no reader lives here; a visitor who's already signed in is redirected straight past it to the app.
- **Everything else is the application**, gated behind Google sign-in: `dashboard.html` (home), `library.html` (upload/browse + the reading workspace itself), `forest.html`, `analytics.html`, `profile.html`, and `settings.html`, all sharing one nav bar. Signing in is required to read — this is a genuine account-based product now, not a local-only tool with optional sync.

## Features

- **PDF and text/markdown support** — drop a `.pdf`, `.txt`, or `.md` file, or use the file picker, from your Library
- **Real page-turn interaction** — drag-to-flip with a rotating leaf and fold shadow; hover-to-flip for mouse/trackpad users (no click required); press-and-drag on touchscreens
- **Spread or single-page view**, with a proper cover-alone / paired-spread layout
- **Crisp at any display density** — canvases render at native device pixel ratio, not just CSS size
- **Zoom, thumbnails, fullscreen, keyboard navigation** (`←`/`→`, `Space`, `F`, `T`, `+`/`-`, `G`, `P`, `Esc`)
- **Ambient sound library** (`S`) — white/pink/brown noise, plus 8 environments (rain, ocean, wind, forest, café, library, fireplace, night), all synthesized on the fly with the Web Audio API (no audio files, nothing to download). Deliberately no music or speech: research on background sound and reading finds lyrics and vocal content reliably hurt comprehension, while plain noise and low-semantic ambient sound are neutral-to-helpful and specifically aid some ADHD/dyslexic readers — so that's what's on offer
- **Local library** — drop files into a `library/` folder and they show up as cover cards; click one to open it directly. No manifest, no database — see [library/README.md](library/README.md)
- **Mind Forest** (`G` in the reader, or its own page) — a living, explorable 2D ecosystem that grows as you read. Reading sessions, streaks, book milestones, and finished Pomodoro focus sessions all earn Growth Points, which unlock an ever-growing catalog of trees, plants, and wildlife, each painted with layered gradients and organic shapes rather than flat icons. It follows real time of day and season, and lives in a reader panel and a full "explore your forest" view where you can drag to pan around, tap any tree or creature to see when it was planted and which reading session grew it, filter by document or date range, and drag things to a new spot to personalize your grove
- **Three.js, used once, on purpose** — the one WebGL touch is a soft additive-glow firefly field at night, gated behind its own unlock; everything else in the forest is layered SVG and CSS
- **Pomodoro focus timer** (`P`) — a focus/break cycle built into the reader itself. A completed focus session feeds straight into the Mind Forest rather than being tracked separately
- **A dashboard that's actually a home screen** — what to read next, a "continue reading" card for your last session, today's forest growth, your current streak, recent accomplishments, and a one-tap "start a focus session"
- **Reading analytics** — a 12-week calendar heatmap, streak history, recent sessions, time spent per document, consistency and focus-score metrics
- **Achievements** — 9 unlockable badges (first session, 7-day streak, 10 hours focused, first tree, first forest, 1,000 pages, night reader, weekend reader, knowledge explorer), each checked against real tracked numbers, with a one-time unlock animation
- **Cross-device sync** — sign in with Google and your Mind Forest, reading history, and streaks follow you to any device. Your files themselves are never uploaded — only reading activity metadata syncs

## Running it

This is static HTML/CSS/JS with no build step, but it must be served over `http://` (not opened as a raw `file://` path) because it uses ES modules:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`. Any other static file server works too (`npx serve`, `php -S`, etc). You'll need your own Supabase project wired up (see "Backend" below) for sign-in to actually work.

## How it works

**Marketing (signed out)**
- **`index.html`** — the landing page: hero, product story, feature demos, FAQ, sign-in CTA. Checks auth on load and redirects a signed-in visitor to `dashboard.html` before anything renders
- **`landing.js`** — the landing page's own script: scroll-reveal, smooth-scroll nav, the growth-stage and Pomodoro-ring demo loops, the playable ambience preview grid, and the sign-in buttons. Touches only `auth.js` (to check/redirect) and `sound.js` — never `forest-state.js`, `cloud-sync.js`, or anything else that assumes an account

**Shared app chrome (signed in)**
- **`app-nav.js`** — `requireAuth()` (redirects to `index.html` if nobody's signed in) and `mountAppNav()` (renders the Dashboard/Library/Read/Mind Forest/Analytics/Profile/Settings nav + account widget), used by every page below

**The application**
- **`dashboard.html` / `dashboard.js` / `dashboard.css`** — the home screen: quick stats, continue-reading card, today's forest snapshot, what-to-read-next, recent accomplishments, and a focus-session CTA
- **`library.html`** — upload a file or browse the `library/` folder, and the reading workspace itself (page-flip, Pomodoro, ambient sound, forest panel). The nav bar hides while actually reading, for a distraction-free workspace, and reappears on return
- **`app.js`** — the reader's orchestrator: file loading, PDF rendering, text pagination, the page-flip state machine (drag + hover), thumbnails, zoom, keyboard shortcuts, and wiring for the Pomodoro/sound/forest panels
- **`forest.html` / `forest.js`** — the full explorable Mind Forest, with a document/date-range filter over the growth-event history
- **`analytics.html` / `analytics.js`** — the calendar heatmap, streak history, recent sessions, time-per-document, and consistency/focus-score metrics
- **`profile.html` / `profile.js` / `profile.css`** — identity, lifetime stats, your library, growth timeline, and achievements
- **`settings.html` / `settings.js` / `settings.css`** — default ambient volume, replaying the first-run onboarding, sign-out

**Shared engines** (used by one or more of the pages above)
- **`sound.js`** — the ambient sound engine: procedural noise/rain/ocean/wind/forest/café/library/fireplace/night, each a short seamlessly-looping buffer played through the Web Audio API
- **`library.js`** — discovers books by fetching the static server's auto-generated directory listing for `library/`
- **`forest-state.js`** — the Mind Forest economy: Growth Points, streaks, per-book milestone tracking, the unlock catalog, per-item unlock records, custom item positions. Persisted to `localStorage`; no rendering
- **`forest-scene.js`** — turns the unlocked catalog into a layered SVG scene: gradient sky, seasonal palettes, organic artwork, pan/select/drag interaction, tap-to-inspect popover, plus the one Three.js firefly field
- **`pomodoro.js`** — the focus/break timer engine, tracked by wall-clock end-timestamps
- **`celebrate.js`** — celebration toasts and the first-run onboarding story
- **`auth.js`** — Supabase Auth wrapper: Google sign-in, session persistence/refresh, `onAuthChange`. The only file that touches the `window.supabase` global
- **`cloud-sync.js`** — bridges reading activity to Supabase: upserts a `documents` row per opened file, inserts a `reading_sessions` row per open/close, appends one `growth_events` row per GP-earning moment
- **`profile-data.js`** — one consolidated Supabase query (documents, reading_sessions, growth_events, profiles, `get_my_totals()`) turned into per-document aggregates, a calendar heatmap, streak runs, and a growth-event timeline. Read-only; used by dashboard/forest/analytics/profile
- **`achievements.js`** — the achievement catalog and its unlock checks, each reading only real tracked numbers — nothing fabricated
- **`vendor/`** — [pdf.js](https://mozilla.github.io/pdf.js/) (MIT/Apache-2.0), [three.js](https://github.com/mrdoob/three.js) (MIT), and [supabase-js](https://github.com/supabase/supabase-js) (MIT), vendored locally so the app has no CDN dependency

PDF pages and rendered text pages are cached per `(page, zoom, viewport height)` key and reused between the flat view and the flip animation, so navigating around doesn't re-render pages you've already visited at the current zoom level.

## Backend (required for the app; not for the marketing page)

The marketing page (`index.html`) needs nothing — it's static. Everything past sign-in is backed by a normalized Postgres schema in Supabase:

- **`profiles`** — one row per authenticated user, created automatically by a trigger on `auth.users`
- **`documents`** — one row per file a user has opened (`file_key` = name+page-count, not the file itself — files never leave the browser)
- **`reading_sessions`** — one row per "opened this book" session, with pages read and duration
- **`growth_events`** — an **append-only ledger**, one row per GP-earning moment (`user_id`, `document_id`, `file_name`, `session_id`, `pages_read`, `time_spent_seconds`, `growth_type`, `growth_value`, `created_at`). This is the source of truth: the forest is meant to be reconstructed by replaying/aggregating these events, not by trusting a single mutable "current state" row — so every unlock is traceable back to the specific book and session that grew it

All four tables have row-level security enabled (a user can only ever read/write their own rows), plus two `SECURITY DEFINER`/`SECURITY INVOKER` RPC functions: `get_my_totals()` (a user's own aggregate stats) and `get_leaderboard()` (aggregate GP + display name only, never raw events, across all users — for a future leaderboard feature).

The client only ever holds a publishable (anon) key; every table is locked down by RLS, so that key grants no access beyond what a signed-in user owns.

### Running your own backend

The full schema lives in [`supabase/migrations/`](supabase/migrations/) and is applied via the Supabase CLI/MCP, not by clients. To point this app at your own Supabase project:

1. Create a Supabase project and run the migrations in `supabase/migrations/` against it (`supabase db push`, or apply each file in order via the SQL editor / MCP `apply_migration`).
2. **Enable the Google provider** — this one step can't be scripted, it's a dashboard-only action: in your Supabase project, go to **Authentication → Providers → Google**, toggle it on, and supply a Google Cloud OAuth **Client ID** and **Client Secret** (create these in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) under an OAuth 2.0 Client ID of type "Web application", with your Supabase project's callback URL — shown on that same Providers page — added as an authorized redirect URI).
3. Update `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` at the top of `auth.js` with your project's values (`Project Settings → API`).

Without step 2, the rest of the app works fine — the Google sign-in button will just fail with an auth-provider error until it's configured.

## Ideas for contributors

This is a small, hackable codebase — good first-issue territory. Some directions that would be welcome:

- EPUB support
- Swipe/keyboard support tuning on mobile
- Double-page leaf physics that account for both recto/verso content instead of a single-face flip
- Accessibility pass (ARIA labels, screen-reader page announcements)
- A theme picker and flip-sensitivity control on the Settings page (currently just ambient volume + onboarding replay + sign-out)
- More ambient sounds, or the ability to layer more than one at once (e.g. rain + brown noise)
- A fallback for the library on hosts without directory-listing support (e.g. an optional manifest.json a contributor could opt into)
- Notes and highlights — the library cards already have a slot for these counts (currently always 0, honestly, since the feature doesn't exist yet)
- A real leaderboard UI — the `get_leaderboard()` RPC is already there, unused
- "Resume last session" currently only works for files in the `library/` folder (refetchable by name) — an ad-hoc drag-and-drop upload can't be reopened without the file itself
- Tests — there currently are none

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up.

## License

MIT — see [LICENSE](LICENSE). pdf.js is bundled under its own license (Apache 2.0); see [vendor/](vendor/).
