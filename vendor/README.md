# vendor/

Third-party code, bundled locally so the app has no CDN dependency and works fully offline.

- `pdf.min.mjs`, `pdf.worker.min.mjs` — [pdf.js](https://github.com/mozilla/pdf.js) by Mozilla, licensed under [Apache License 2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE). Not modified from the upstream build.
- `three.module.min.js` — [three.js](https://github.com/mrdoob/three.js) r160, licensed under [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE). Not modified from the upstream build (`build/three.module.min.js` from the `three` npm package). Used sparingly for the Mind Forest ambient scene — no heavy 3D, just a small low-poly canvas.

To update: download the matching `pdf.min.mjs` + `pdf.worker.min.mjs` pair for a newer pdf.js release (they must be from the same version) and replace both files here. For three.js, `npm pack three@<version>` and pull `build/three.module.min.js` out of the tarball.
