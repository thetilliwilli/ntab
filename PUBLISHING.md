# Publishing an update to the Chrome Web Store

```sh
npm run release
```

builds everything into `ignore/publish/` and writes `ignore/publish/README.md` with the steps: the package,
every text field as its own file (copy and paste), five 1280×800 screenshots, the promo tiles and the icon.
Then upload it by hand in the dashboard (https://chrome.google.com/webstore/devconsole) and, once the store has
published it, run `npm run release:done` to record the version.

`npm run release -- --draft` builds even when the checks fail, to preview screenshots and texts.

## What the script checks

- the tree is committed (the package is built from HEAD with `git archive`);
- `version` in `manifest.json` is above the one in `store/published.json`: `x.y.Z+1` for fixes, `x.Y+1.0` for
  features, `X+1.0.0` for big changes;
- text lengths (name 75, summary 132, description 16 000, privacy fields 1 000);
- each permission has a justification in `store/privacy/<permission>.txt`, and new permissions since the last
  release are flagged.

## Sources

- `manifest.json` — store name (`name`), summary (`description`), version, permissions
- `store/description.txt` — the long description; update its WHAT'S NEW part for each release
  (`ignore/publish/changes.txt` lists the commits since the last one)
- `store/privacy/` — single purpose and one justification per permission
- `store/listing.json` — category, language, homepage and support URLs
- `store/demo.mjs` — actions and notes shown on the screenshots
- `store/published.json` — the version live in the store, its permissions and commit
- `scripts/release.mjs` — the script; screenshot scenes are in `screenshots()`

Screenshots are taken in headless Chrome (`CHROME=/path/to/chrome` to override) on the test page from `test/`.
Site icons are fetched from Google's favicon service; offline, the tiles show letters (the README says so).

## Before changing storage or permissions

- A new permission with a warning disables the extension for existing users until they accept it.
- Users keep the data of the previous version: if a storage key or format changes, the new version has to
  read the old one (migrate), or their actions/settings are lost.
