git # library/

Drop `.pdf`, `.txt`, or `.md` files here and they'll show up as cover cards on the app's landing page — no manifest file, no build step, no restart needed (just refresh, or hit "rescan").

This works because most static file servers (`python -m http.server`, nginx, Apache) auto-generate a directory listing page for a folder that has no `index.html` in it, and the app just reads the file links out of that listing. Hosts that don't support directory listing (GitHub Pages, most static CDNs) simply won't show a library section — that's expected, it's local-only progressive enhancement.

Everything you put in this folder is **git-ignored** (see `.gitignore`) except this README — your books stay on your machine and are never committed or pushed, even though the rest of this repo is public.
