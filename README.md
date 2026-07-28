# zine reader

A browser-native reader for PDF and plain-text zines. No backend, no database, no build step — open a file and read it, entirely client-side.

Turn pages the way you'd turn a real one: drag a page from its edge, or just hover your cursor (or trackpad) near the edge and sweep across.

## Features

- **PDF and text/markdown support** — drop a `.pdf`, `.txt`, or `.md` file, or use the file picker
- **Real page-turn interaction** — drag-to-flip with a rotating leaf and fold shadow; hover-to-flip for mouse/trackpad users (no click required); press-and-drag on touchscreens
- **Spread or single-page view**, with a proper cover-alone / paired-spread layout
- **Crisp at any display density** — canvases render at native device pixel ratio, not just CSS size
- **Zoom, thumbnails, fullscreen, keyboard navigation** (`←`/`→`, `Space`, `F`, `T`, `+`/`-`, `G`, `P`, `Esc`)
- **Ambient sound library** (`S`) — white/pink/brown noise and rain/ocean/wind, synthesized on the fly with the Web Audio API (no audio files, nothing to download). Deliberately no music or speech: research on background sound and reading finds lyrics and vocal content reliably hurt comprehension, while plain noise and low-semantic nature sound are neutral-to-helpful and specifically aid some ADHD/dyslexic readers — so that's what's on offer
- **Local library** — drop files into a `library/` folder and they show up as cover cards on the landing page; click one to open it directly. No manifest, no upload, no database — see [library/README.md](library/README.md)
- **Mind Forest** (`G`) — a small persistent Three.js diorama that grows as you read. Reading sessions, streaks, book milestones, and finished Pomodoro focus sessions all earn Growth Points, which unlock an ever-growing catalog of trees, plants, and wildlife. It follows real time of day (day/dusk/night, with fireflies and stars after dark) and lives on the landing page as well as in a reader panel — a preview of your progress even before you open a book
- **Pomodoro focus timer** (`P`) — a focus/break cycle built into the reader itself. A completed focus session feeds straight into the Mind Forest rather than being tracked separately
- **Reward consistency, not speed** — a daily streak counter, session/focus-time stats, and tasteful celebration toasts on unlocks and milestones. Everything is a lifetime total that only ever goes up
- **100% local** — nothing is uploaded anywhere; everything runs in your browser, and all progress is kept in `localStorage` on this device only

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
- **`forest-state.js`** — the Mind Forest economy: Growth Points, streaks, per-book milestone tracking, and the unlock catalog. Pure state + a small event emitter, persisted to `localStorage`; no rendering
- **`forest-scene.js`** — turns the unlocked catalog into a lightweight Three.js diorama (low-poly procedural shapes, no model loading, no shadow maps, capped pixel ratio, render loop stops when hidden)
- **`pomodoro.js`** — the focus/break timer engine, tracked by wall-clock end-timestamps so a backgrounded tab still reports correct time; a completed focus phase calls into `forest-state.js`
- **`celebrate.js`** — celebration toasts and the first-run onboarding story, both hand-rolled with CSS/WAAPI (no React, no video-render pipeline — this app has no build step)
- **`vendor/`** — [pdf.js](https://mozilla.github.io/pdf.js/) (MIT/Apache-2.0) and [three.js](https://github.com/mrdoob/three.js) (MIT), vendored locally so the app has no CDN dependency

PDF pages and rendered text pages are cached per `(page, zoom, viewport height)` key and reused between the flat view and the flip animation, so navigating around doesn't re-render pages you've already visited at the current zoom level.

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
