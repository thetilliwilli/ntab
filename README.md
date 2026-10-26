# Custom New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a
tabbed plain-text notepad (think Notepad++) and a vertical shortcuts sidebar. Notes are plain text files
in a local folder you pick, saved on every change, and the open tabs survive browser restarts.
No dependencies, no build step.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Press <kbd>Ctrl</kbd>+<kbd>T</kbd> — Chrome shows a one-time prompt to keep the change; click **Keep it**
5. Click **choose folder…** and pick the folder for your notes

After editing any file, hit the reload icon on the extension card in `chrome://extensions`.

## Notes

- Double-click the free space of the tab bar to create `newN.txt`. `[+]` lists every file in the folder
  except dotfiles (filter, open, delete, change folder).
- Tabs show the full file name. Double-click a tab to rename the file — the extension is whatever you type
  (`note.md`, `log`, …). Drag tabs to reorder. Middle-click or `×` closes.
- Closing a tab you haven't edited since opening it just closes it. Closing an edited one opens a panel to name the file (first line / current name / anything typed);
  the file stays in the folder. Closing an empty tab deletes its file. With no tabs open the page shows
  the same file list with a filter in place of the editor — no placeholder note is created.
- Every keystroke is written to a draft in `chrome.storage.local` at once and to the file 300 ms later;
  a draft newer than its file (page closed mid-write) is restored on next load.
- Several open new-tab pages stay in sync. A file changed by another program is reloaded when you come
  back to the page, unless there are unsaved edits.
- After a browser restart Chrome may ask to re-allow folder access (one click). Choosing
  “Allow on every visit” in Chrome's prompt removes that step.
- Status bar: cursor position, length, save state, font size `A− / A+`, word wrap, spaces per Tab, theme.

## Shortcuts

Hovering a shortcut shows a flyout with its icon, full name and URL (handy with the sidebar collapsed).
Edit via **edit shortcuts** at the bottom of the sidebar — a form or raw JSON
(`[{ "name": "…", "url": "…", "target": "_blank" }]`). Shortcuts and settings live in
`chrome.storage.sync`, so they follow your Chrome profile across machines.

Icons: your uploaded icon if any, otherwise Chrome's own favicon cache (sites you've visited in this
profile, no network), otherwise the first letter. `⤒` in the editor uploads any image; it is scaled to a
32×32 PNG and kept per hostname in `chrome.storage.local` (this machine only).

## Files

- `manifest.json` — MV3; `chrome_url_overrides.newtab`, permissions `storage`, `favicon`
- `newtab.html` / `newtab.css` — layout and theme tokens (auto / light / dark)
- `js/main.js` — wiring, settings, folder connect flow
- `js/notes.js` — open notes, autosave + drafts, session, cross-page sync
- `js/editor.js` — textarea, line numbers, Tab indent, cursor status
- `js/fs.js` / `js/idb.js` — File System Access helpers, folder handle persisted in IndexedDB
- `js/tabbar.js`, `js/dialogs.js` — tab strip, `[new]` dialog, close panel
- `js/sidebar.js`, `js/shortcuts.js`, `js/settings.js` — shortcuts sidebar, its editor, storage
