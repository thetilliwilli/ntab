# NTab: Notepad New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a home
screen of large action tiles and a narrow sidebar with the same actions. Actions are links and apps:

- **Notes** — a tabbed plain-text notepad (think Notepad++), saved as you type, open tabs survive restarts;
- **Tracker** — tap a tile to log that something happened (smoked, workout, called mom…), or start an
  activity that runs until you finish it;
- **Board** — a kanban board: tasks in New / Work / Hold / Done.

All app data lives in one local folder you pick, as plain files. No dependencies, no build step.
Requires Chrome 122+.

## Install

From the Chrome Web Store, or unpacked:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Press <kbd>Ctrl</kbd>+<kbd>T</kbd> — Chrome shows a one-time prompt to keep the change; click **Keep it**
5. Click **Notes** (or any app), then **choose folder…** and pick the folder for your data

After editing any file, hit the reload icon on the extension card in `chrome://extensions`.

## Home screen

Every new tab, reload and browser restart starts at the home screen, so notes never appear on screen by
themselves (handy when sharing the screen). An app opens from its tile or its sidebar icon; the
house button at the top of the sidebar goes back home. Switching screens adds no browser history.
The data folder is only touched when an app is opened, so the home screen loads instantly.

## Data folder

```
<folder>/
  ntab.json                     { "format": 1 }: marks the layout; the root holds only what the whole extension needs
  notes/                        one plain text file per note
  tracker/types.json            event types
  tracker/events-YYYY-MM.jsonl  the log, one JSON event per line, a file per month
  board/tasks.json              tasks
```

Each app keeps its files in its own subfolder. Up to 2.1 the notes were the files in the root of the folder;
when such a folder is opened (files in the root, no `ntab.json`), the gate offers to move them into `notes/`.

## Notepad

- Double-click the free space of the tab bar to create `newN.txt`. `[+]` lists every file in `notes/`
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

## Tracker

- An **event type** has an emoji, a name and an id (a slug of the first name; it never changes, so renaming
  keeps the history). **+ new type** adds one: pick the icon from the suggestions or from **all emoji…** (every
  single-character emoji the browser knows, found at runtime, no emoji data shipped, so no search), or paste one; **edit types** renames, reorders, switches one-shot ⇄ activity
  and archives (an archived type loses its tile, its events keep their name in the log).
- A tile click logs an event with the current time. A type marked *lasts a while* starts an **activity**
  instead: it shows on top with its running time, a growing bar and **Finish**, which logs its end.
- The day log below (◀ ▶ today) lists events; click a time to correct it, `×` deletes (an activity's start
  takes its end with it). Every log, finish and delete can be undone from the toast.
- Events in `tracker/events-YYYY-MM.jsonl`:

  ```
  { "id": "…", "type": "smoked", "time": 1767000000000 }                                       one-shot
  { "id": "…", "type": "sleep", "time": …, "activity": "<uuid>", "phase": "start" }           activity start
  { "id": "…", "type": "sleep", "time": …, "activity": "<same uuid>", "phase": "end" }        activity end
  ```

  New events are appended under a Web Lock (pages never overwrite each other's lines); fixing or deleting
  one rewrites its month. Other pages pick changes up at once; changes by other programs on return to the page.

## Board

Columns New / Work / Hold / Done. **+ task** (or `+` in New) creates a task with a name and a description;
click a card to edit it, change its status or delete it. Drag cards between and within columns (the mouse
anywhere on a card, a finger by its `⋮⋮` handle). `board/tasks.json` holds
`{ "tasks": [{ id, name, description, status, created, updated }] }` in board order; every change re-reads
the file under a Web Lock, so changes from other pages are never lost.

## Actions

One list drives both the home tiles and the sidebar. The home screen groups it: apps under **Apps**,
links under **Links**; the sidebar keeps the list order. The dashed **+ Add** tile at the end of Links opens a
small dialog for one new link (URL, name — defaults to the host name —, icon upload, new tab); it is added at
the end of the list. Hovering a sidebar icon shows a flyout with its full
name and URL. Edit with ✎ at the bottom of the sidebar (the button above it switches the theme:
auto / light / dark) — a form or raw JSON:

```json
[
  { "type": "notes", "name": "Notes" },
  { "type": "tracker", "name": "Tracker" },
  { "type": "board", "name": "Board" },
  { "name": "Gmail", "url": "https://mail.google.com" },
  { "name": "YouTube", "url": "https://youtube.com", "target": "_blank" }
]
```

An item without `type` is a link; `"type"` names an app (`notes`, `tracker`, `board`). The default list starts
with the three apps; the editor's **+ notepad / + tracker / + task board** buttons add an app that isn't in the
list (lists saved by older versions don't get the new apps by themselves). Without the notepad the editor shows
**add it back** and asks before saving. Items of an app this version doesn't know (synced from a newer version
on another machine) are hidden and kept.
Actions and settings live in `chrome.storage.sync`, so they follow your Chrome profile across machines.

Icons: your uploaded icon if any, otherwise Chrome's own favicon cache (sites you've visited in this
profile, no network) or the app's built-in icon, otherwise the first letter. `⤒` in the editor uploads
any image; it is scaled to a 128×128 PNG and kept per hostname (or app id) in `chrome.storage.local`
(this machine only).

## Permissions and privacy

- `storage` — settings and actions (sync), open tabs, drafts and uploaded icons (local).
- `favicon` — reads action icons from Chrome's local favicon cache.

No host permissions, no network requests, nothing leaves the browser except what Chrome sync does with
`chrome.storage.sync`. Notes, tracker and board data are only in the folder you choose.

## Publishing

`npm run release` builds the package, store texts and screenshots into `ignore/publish/`; see
[PUBLISHING.md](PUBLISHING.md).

## Files

Sources are plain ES modules, split by role:

- `manifest.json` — MV3; `chrome_url_overrides.newtab`, permissions `storage`, `favicon`
- `newtab.html` — the page: shell, the screens of all apps, dialogs
- `icons/` — `icon.svg` (source, also the page favicon) and the PNG sizes for the manifest
- `platform/` — the only place that calls `chrome.*` (storage, favicon cache); `index.js` picks the platform
- `shared/` — code every part uses:
  - `base.css` — theme tokens, controls, dialogs
  - `settings.js` — settings, the action list and uploaded icons in browser storage (layout at its top)
  - `folder.js`, `idb.js` — the data folder (File System Access), its layout and upgrade; handle in IndexedDB
  - `util.js` — DOM helpers, formatting, drag-to-reorder
- `shell/` — the frame around the apps:
  - `main.js` — entry point: theme, folder gate, screens
  - `apps.js` — the app registry and the app contract
  - `view.js` — current screen (home / an app id)
  - `actions.js`, `sidebar.js`, `home.js` — the action list and icons, the sidebar with its flyout, home tiles
  - `actions-dialog.js`, `add-link.js`, `icon-file.js` — the actions editor, the + Add dialog, icon upload
  - `theme.js` — applies the saved theme before the first paint
- `apps/notes/` — `index.js` (the app), `notes.js` (open notes, autosave + drafts, session, cross-page sync),
  `editor.js`, `tabbar.js`, `dialogs.js`, `files.js` (note files in `notes/`)
- `apps/tracker/` — `index.js` (UI), `model.js` (types, events, activities), `store.js` (files)
- `apps/board/` — `index.js` (UI, drag and drop), `model.js` (tasks and their file)
- `store/`, `scripts/release.mjs` — store listing sources and the release builder
- `test/` — headless Chrome harness (`chrome.*` stub, CDP helpers, smoke, tracker and board tests); not part
  of the package
