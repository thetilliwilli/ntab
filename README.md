# Custom New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a home
screen of large action tiles and a narrow sidebar with the same actions. One of the actions is a tabbed
plain-text notepad (think Notepad++): notes are plain text files in a local folder you pick, saved as you
type, and the open tabs survive browser restarts. No dependencies, no build step. Requires Chrome 122+.

## Install

From the Chrome Web Store, or unpacked:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Press <kbd>Ctrl</kbd>+<kbd>T</kbd> — Chrome shows a one-time prompt to keep the change; click **Keep it**
5. Click **Notes**, then **choose folder…** and pick the folder for your notes

After editing any file, hit the reload icon on the extension card in `chrome://extensions`.

## Home screen

Every new tab, reload and browser restart starts at the home screen, so notes never appear on screen by
themselves (handy when sharing the screen). The notepad opens from its tile or its sidebar icon; the
house button at the top of the sidebar goes back home. Switching screens adds no browser history.
The notes folder is only touched when the notepad is opened, so the home screen loads instantly.

## Notepad

- Double-click the free space of the tab bar to create `newN.txt`. `[+]` lists every file in the folder
  except dotfiles (filter, open, delete, change folder). With no tabs open the page shows the same list
  in place of the editor.
- Tabs show the full file name. Double-click a tab to rename the file — the extension is whatever you type
  (`note.md`, `log`, …). Drag tabs to reorder. Middle-click or `×` closes. Right-click → **Delete file**
  deletes the file and closes its tab at once, without asking.
- Closing a tab:
  - not edited since it was opened, or empty — it just closes;
  - edited — a panel asks for the file name (first line / current name / anything typed);
  - a new note (`newN.txt` made here) that is still empty — its file is deleted too.
  Files you open from the folder are never deleted by closing them.
- Saving: the file is written 300 ms after you stop typing, and at least every 2 s while you keep typing.
  If the page is closed or hidden before a write finishes, or a write fails, the text is kept as a draft
  in `chrome.storage.local` and written to the file on the next start. Drafts belong to their folder,
  so changing the folder never mixes them up.
- Each new-tab page has its own set of open tabs (kept across reloads and browser restarts); a brand new
  tab opens with the set of the page you were in last. Saved content, renames and deletes are synced
  between pages.
- A file changed by another program is reloaded when you come back to the page, unless there are
  unsaved edits.
- After a browser restart Chrome may ask to re-allow folder access (one click). Choosing
  “Allow on every visit” in Chrome's prompt removes that step.
- Status bar: cursor position, length, save state, font size `A− / A+`, word wrap, spaces per Tab.

## Actions

One list drives both the home tiles and the sidebar. Hovering a sidebar icon shows a flyout with its full
name and URL. Edit with ✎ at the bottom of the sidebar (the button above it switches the theme:
auto / light / dark) — a form or raw JSON:

```json
[
  { "type": "notes", "name": "Notes" },
  { "name": "Gmail", "url": "https://mail.google.com" },
  { "name": "YouTube", "url": "https://youtube.com", "target": "_blank" }
]
```

An item without `type` is a link; `"type": "notes"` opens the notepad. The default list starts with the
notepad. If it is removed, the editor shows **add it back** and asks before saving a list without it.
Actions and settings live in `chrome.storage.sync`, so they follow your Chrome profile across machines.

Icons: your uploaded icon if any, otherwise Chrome's own favicon cache (sites you've visited in this
profile, no network) or the built-in notepad icon, otherwise the first letter. `⤒` in the editor uploads
any image; it is scaled to a 128×128 PNG and kept per hostname (or `notes`) in `chrome.storage.local`
(this machine only).

## Permissions and privacy

- `storage` — settings and actions (sync), open tabs, drafts and uploaded icons (local).
- `favicon` — reads action icons from Chrome's local favicon cache.

No host permissions, no network requests, nothing leaves the browser except what Chrome sync does with
`chrome.storage.sync`. Notes are only in the folder you choose.

## Publishing

See [PUBLISHING.md](PUBLISHING.md); the package is built with `npm run pack`.

## Files

- `manifest.json` — MV3; `chrome_url_overrides.newtab`, permissions `storage`, `favicon`
- `newtab.html` / `newtab.css` — layout and theme tokens
- `icons/` — extension icons (the page itself uses an inline transparent 1×1 favicon)
- `js/theme.js` — applies the saved theme before the first paint
- `js/main.js` — wiring, settings, screens, folder connect flow
- `js/view.js` — current screen (home / notepad)
- `js/notes.js` — open notes, autosave + drafts, session, cross-page sync
- `js/editor.js` — textarea, line numbers, Tab indent, cursor status
- `js/fs.js` / `js/idb.js` — File System Access helpers, folder handle persisted in IndexedDB
- `js/tabbar.js`, `js/dialogs.js` — tab strip, file list, close panel
- `js/sidebar.js`, `js/shortcuts.js`, `js/settings.js` — sidebar and home tiles, the actions editor, storage
- `js/util.js` — DOM helpers, drag-to-reorder
