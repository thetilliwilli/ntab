# Backlog

Plans and ideas that are not decided rules yet (those live in CLAUDE.md). Remove an item once it is done or dropped.

## Next

- **Web / PWA build on GitHub Pages.** The same code as a plain web page: `platform/web.js` (storage on
  `localStorage` + the `storage` event, no `_favicon` → letters or uploaded icons), OPFS as the data folder where
  there is no folder picker (phones), `manifest.webmanifest`, service worker, icons 192/512,
  `navigator.storage.persist()`, export/import of the data folder. Mobile layout is the biggest part.

## Ideas

- **Emoji picker with search** for tracker types: search by name and keywords over all emoji (data generated once
  from Unicode `emoji-test.txt` + CLDR annotations into a JSON file, no dependency), groups to browse, also in
  "edit types". Open questions: Russian keywords, own synonyms.
