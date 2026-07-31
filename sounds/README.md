# sounds/

Recorded ambient loops (sourced from Pixabay) backing 7 of the 8 ambience presets in `sound.js` — real field recordings rather than procedural synthesis, for the sounds where a recording sounds better than a generated approximation. `library` is the one ambience preset with no matching recording, so it stays procedurally generated.

- `wind.mp3` → wind
- `ocean.mp3` → ocean
- `river.mp3` → rain (closest match on hand — a flowing-water bed used in place of a dedicated rain recording; the "Rain" card label was kept since a river and rain read similarly as background texture)
- `forest.mp3` → forest, and the always-on ambience on the Mind Forest pages (see `forest-ambience.js`)
- `cafe.mp3` → café
- `fireplace.mp3` → fireplace
- `night.mp3` → night

Unlike `library/`, this folder is **not** git-ignored — these are app assets, not personal reading material, so they're committed like `vendor/`'s third-party files. Verify Pixabay's license terms before replacing or redistributing these if you fork this project commercially.
