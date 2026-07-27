# Custom New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a custom HTML page.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Press <kbd>Ctrl</kbd>+<kbd>T</kbd> — Chrome shows a one-time prompt to keep the change; click **Keep it**

## Files

- `manifest.json` — MV3 manifest, `chrome_url_overrides.newtab` points at the page
- `newtab.html` / `newtab.css` — the page itself (clock, greeting, search box, shortcut grid)
- `newtab.js` — clock, search submit, shortcut rendering/editing (saved in `chrome.storage.local`)

## Customizing

Edit shortcuts from the page itself via the *edit shortcuts* link, or change `DEFAULT_LINKS` /
`SEARCH_URL` at the top of `newtab.js`. After editing any file, hit the reload icon on the
extension card in `chrome://extensions`.

## Notes

- Ctrl+T keeps keyboard focus in the address bar, so typing goes to the omnibox — that's Chrome's
  behavior and a new tab page cannot steal focus. Click the page's search box to use it.
- Only one extension can own the new tab page; if another one already overrides it, Chrome will ask
  which to keep.
