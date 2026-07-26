# Contributing

Thanks for taking a look — this is a small project and contributions of any size are welcome, from typo fixes to new features.

## Getting set up

No build step, no dependencies to install. Just serve the directory and open it:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`. (It needs to be served over http/https, not opened as `file://`, since `app.js` is an ES module.)

## Project layout

- `index.html` — static shell markup only; avoid adding inline scripts/styles
- `style.css` — all styling, uses CSS custom properties defined in `:root`
- `app.js` — a single IIFE module; no framework, no bundler. Keep it that way unless there's a strong reason to introduce one — part of the point of this project is that anyone can read the whole thing in one sitting
- `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` — pdf.js, vendored so there's no CDN dependency. Don't hand-edit these; if you need a newer version, re-download the matching pair from a pdf.js release and update both files together

## Before opening a PR

- Test in an actual browser tab (not just skim the diff) — this app leans on `requestAnimationFrame`, `devicePixelRatio`, and pointer events, which are easy to get subtly wrong
- Check both PDF and text-file (`.txt`/`.md`) modes if your change touches rendering or pagination
- Check both spread and single-page view
- If you touch the page-flip logic (`beginFlip`, `attachSlotDrag`, hover handling), test: click/keyboard nav, touch drag, and mouse/trackpad hover — including hovering near an edge right after a turn completes (there's a deliberate cooldown there to stop a single swipe from double-flipping; don't remove it without understanding why it's there)
- Keep the "no backend, no build step, no database" constraint — that's a feature of this project, not an oversight

## Filing issues

Bug reports are more useful with: browser + OS, whether it's a PDF or text file, and whether you were using mouse/trackpad/touch. Screen recordings help a lot for interaction bugs.

## Code style

- Match the existing style (no semicolon-free style, no framework idioms) — this is plain vanilla JS/CSS/HTML on purpose
- Prefer small, focused PRs over large rewrites
- No new runtime dependencies without discussion first (an issue is a good place to raise it)
