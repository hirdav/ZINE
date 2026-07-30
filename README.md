# zine reader

A browser-native reader for PDF and plain-text zines. No build step — open a file and read it, entirely client-side. Reading needs no account at all; signing in with Google is optional and only syncs your Mind Forest progress to a small Supabase backend, so it follows you to another device.

Turn pages the way you'd turn a real one: drag a page from its edge, or just hover your cursor (or trackpad) near the edge and sweep across.

## Features

- **PDF and text/markdown support** — drop a `.pdf`, `.txt`, or `.md` file, or use the file picker
- **Real page-turn interaction** — drag-to-flip with a rotating leaf and fold shadow; hover-to-flip for mouse/trackpad users (no click required); press-and-drag on touchscreens
- **Spread or single-page view**, with a proper cover-alone / paired-spread layout
- **Crisp at any display density** — canvases render at native device pixel ratio, not just CSS size
- **Zoom, thumbnails, fullscreen, keyboard navigation** (`←`/`→`, `Space`, `F`, `T`, `+`/`-`, `G`, `P`, `Esc`)
- **Ambient sound library** (`S`) — white/pink/brown noise and rain/ocean/wind, synthesized on the fly with the Web Audio API (no audio files, nothing to download). Deliberately no music or speech: research on background sound and reading finds lyrics and vocal content reliably hurt comprehension, while plain noise and low-semantic nature sound are neutral-to-helpful and specifically aid some ADHD/dyslexic readers — so that's what's on offer
- **Local library** — drop files into a `library/` folder and they show up as cover cards on the landing page; click one to open it directly. No manifest, no upload, no database — see [library/README.md](library/README.md)
- **Mind Forest** (`G`) — a living, explorable 2D ecosystem that grows as you read. Reading sessions, streaks, book milestones, and finished Pomodoro focus sessions all earn Growth Points, which unlock an ever-growing catalog of trees, plants, and wildlife, each painted with layered gradients and organic shapes rather than flat icons. It follows real time of day and season (spring/summer/autumn/winter foliage, snow, falling leaves, fireflies and stars after dark), and lives on the landing page, a reader panel, and a full "explore your forest" view where you can drag to pan around, tap any tree or creature to see when it was planted and which reading session grew it, and drag things to a new spot to personalize your grove
- **Three.js, used once, on purpose** — the one WebGL touch is a soft additive-glow firefly field at night, gated behind its own unlock; everything else in the forest (the trees, the clouds, the seasons, the pan/select/drag interaction) is layered SVG and CSS, since that's what makes rich painterly artwork and reliable hit-testing actually easy without a build step
- **Pomodoro focus timer** (`P`) — a focus/break cycle built into the reader itself. A completed focus session feeds straight into the Mind Forest rather than being tracked separately
- **Reward consistency, not speed** — a daily streak counter, session/focus-time stats, and tasteful celebration toasts on unlocks and milestones. Everything is a lifetime total that only ever goes up
- **Local-first, cloud-optional** — reading and forest progress work fully offline in `localStorage` with no account. Sign in with Google (👤 in the topbar, or the landing page) and the same progress also syncs to a Supabase backend, so opening the app on another device catches up rather than starting over
- **100% local by default** — nothing is uploaded anywhere unless you choose to sign in; even then, only Mind Forest growth data leaves the browser, never the files themselves

## Running it

This is static HTML/CSS/JS with no build step, but it must be served over `http://` (not opened as a raw `file://` path) because it uses ES modules:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`. Any other static file server works too (`npx serve`, `php -S`, etc).

## How it works

- **`index.html`** — page shell (drop screen + reader UI)
- **`style.css`** — all styling
- **`app.js`** — the orchestrator: file loading, PDF rendering, text pagination, the page-flip state machine (drag + hover), thumbnails, zoom, keyboard shortcuts, and wiring for every panel below
- **`sound.js`** — the ambient sound engine: procedural white/pink/brown noise and rain/ocean/wind, each built as a short seamlessly-looping buffer and played through the Web Audio API
- **`library.js`** — discovers books by fetching the static server's auto-generated directory listing for `library/` and reading the file links out of it
- **`forest-state.js`** — the Mind Forest economy: Growth Points, streaks, per-book milestone tracking, the unlock catalog, per-item unlock records (when/which session), and custom (dragged) item positions. Pure state + a small event emitter, persisted to `localStorage`; no rendering
- **`forest-scene.js`** — turns the unlocked catalog into a layered SVG scene: gradient sky, seasonal palettes, organic hand-built artwork per item, pan/select/drag interaction (via SVG's own coordinate transforms, not raycasting), and a tap-to-inspect popover. The one Three.js piece — a small additive-blended firefly point field — is a separate class in the same file, rendered on a transparent canvas layered over the SVG and only started once that unlock exists
- **`pomodoro.js`** — the focus/break timer engine, tracked by wall-clock end-timestamps so a backgrounded tab still reports correct time; a completed focus phase calls into `forest-state.js`
- **`celebrate.js`** — celebration toasts and the first-run onboarding story, both hand-rolled with CSS/WAAPI (no React, no video-render pipeline — this app has no build step)
- **`auth.js`** — Supabase Auth wrapper: Google sign-in, session persistence/refresh, and an `onAuthChange` subscription. The only file that touches the `window.supabase` global
- **`cloud-sync.js`** — bridges reading activity to Supabase once signed in: upserts a `documents` row per opened file, inserts a `reading_sessions` row per open/close, and appends one `growth_events` row per GP-earning moment. Every function is a no-op when signed out and swallows its own errors — cloud sync is a best-effort backup layer, never a blocker for reading
- **`vendor/`** — [pdf.js](https://mozilla.github.io/pdf.js/) (MIT/Apache-2.0), [three.js](https://github.com/mrdoob/three.js) (MIT), and [supabase-js](https://github.com/supabase/supabase-js) (MIT), vendored locally so the app has no CDN dependency

PDF pages and rendered text pages are cached per `(page, zoom, viewport height)` key and reused between the flat view and the flip animation, so navigating around doesn't re-render pages you've already visited at the current zoom level.

## Backend (optional account features)

Signing in is entirely optional — everything above works with zero setup. When you do sign in, progress is backed by a normalized Postgres schema in Supabase:

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
- Bookmarking / "continue where you left off" (would need `localStorage`, still no backend)
- Double-page leaf physics that account for both recto/verso content instead of a single-face flip
- Accessibility pass (ARIA labels, screen-reader page announcements)
- A settings panel for flip sensitivity / animation speed
- More ambient sounds, or the ability to layer more than one at once (e.g. rain + brown noise)
- A fallback for the library on hosts without directory-listing support (e.g. an optional manifest.json a contributor could opt into)
- Tests — there currently are none

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up.

## License

MIT — see [LICENSE](LICENSE). pdf.js is bundled under its own license (Apache 2.0); see [vendor/](vendor/).
