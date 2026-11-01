# Backlog

Plans and ideas that are not decided rules yet (those live in CLAUDE.md). Remove an item once it is done or dropped.

## Next

- **Web / PWA build on GitHub Pages.** The same code as a plain web page: `platform/web.js` (storage on
  `localStorage` + the `storage` event, no `_favicon` → letters or uploaded icons), OPFS as the data folder where
  there is no folder picker (phones), `manifest.webmanifest`, service worker, icons 192/512,
  `navigator.storage.persist()`, export/import of the data folder. Mobile layout is the biggest part.

## Ideas

- **Emoji picker beyond the 28 suggestions** (decision pending; no bundled emoji data, the user declined that):
  browse all ~1400 single-code-point emoji enumerated with `/\p{RGI_Emoji}/v` (no data, no search, rough groups
  by code point range), and/or a small hand-written keyword list for a curated set.
