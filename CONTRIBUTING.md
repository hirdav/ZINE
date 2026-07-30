# Contributing

Thanks for taking a look — this is a small project and contributions of any size are welcome, from typo fixes to new features.

## Getting set up

No build step, no dependencies to install. Just serve the directory and open it:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`. (It needs to be served over http/https, not opened as `file://`, since the JS is loaded as ES modules.) The application pages (everything but `index.html`) need a Supabase project wired up to actually sign in — see the README's "Backend" section.

## Project layout

There are two halves, kept deliberately separate — see the README for the full breakdown of both.

- `index.html` + `landing.js` — the marketing page. Static shell + one script; no app logic (no `forest-state.js`, no `cloud-sync.js`) should ever be loaded here
- `dashboard.html`, `library.html`, `forest.html`, `analytics.html`, `profile.html`, `settings.html` — the application, each a small page + its own script, sharing `app-nav.js` for the nav bar and sign-in guard
- `style.css` — shared styling (reset, tokens, reader/nav chrome), uses CSS custom properties defined in `:root`; `profile.css`/`dashboard.css`/`settings.css` hold page-specific additions
- `app.js` — the reading workspace's orchestrator (loaded by `library.html`): a single IIFE module; no framework, no bundler. Keep it that way unless there's a strong reason to introduce one
- `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` — pdf.js, vendored so there's no CDN dependency. Don't hand-edit these; if you need a newer version, re-download the matching pair from a pdf.js release and update both files together
- `sound.js` — the ambient noise/nature sound engine (Web Audio API)
- `library.js` — local library discovery via directory-listing scraping (see `library/README.md`)

## Before opening a PR

- Test in an actual browser tab (not just skim the diff) — this app leans on `requestAnimationFrame`, `devicePixelRatio`, and pointer events, which are easy to get subtly wrong
- Check both PDF and text-file (`.txt`/`.md`) modes if your change touches rendering or pagination
- Check both spread and single-page view
- If you touch the page-flip logic (`beginFlip`, `attachSlotDrag`, hover handling), test: click/keyboard nav, touch drag, and mouse/trackpad hover — including hovering near an edge right after a turn completes (there's a deliberate cooldown there to stop a single swipe from double-flipping; don't remove it without understanding why it's there)
- If you touch `library.js`, test with an empty `library/` folder, a missing one, and one with a few files — and don't drop real books into your test to accidentally `git add`; `library/*` is gitignored except its README on purpose
- Keep the "no build step, no bundler, no framework" constraint — that's a feature of this project, not an oversight. The Supabase backend is real and required for sign-in, but the frontend stays plain HTML/CSS/JS
- If you touch anything auth-gated, test both signed-out (should redirect to `index.html`) and signed-in. There's no committed test harness, but the fastest way to test without going through real Google OAuth is serving a stub in place of `vendor/supabase.umd.js` that sets `window.supabase.createClient()` to return a fake session/client

## Filing issues

Bug reports are more useful with: browser + OS, whether it's a PDF or text file, and whether you were using mouse/trackpad/touch. Screen recordings help a lot for interaction bugs.

## Code style

- Match the existing style (no semicolon-free style, no framework idioms) — this is plain vanilla JS/CSS/HTML on purpose
- Prefer small, focused PRs over large rewrites
- No new runtime dependencies without discussion first (an issue is a good place to raise it)
