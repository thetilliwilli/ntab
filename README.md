# NTab: Notepad New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a home
screen of large action tiles and a narrow sidebar with the same actions. Actions are links and apps:

- **Notes** — a tabbed plain-text notepad (think Notepad++), saved as you type, open tabs survive restarts;
- **Tracker** — tap a tile to log that something happened (smoked, workout, called mom…), or start an
  activity that runs until you finish it;
- **Board** — a kanban board: tasks in New / Work / Hold / Done.

All data lives in the browser (IndexedDB); a backup is one JSON file. No dependencies, no build step.
Requires Chrome 122+.

## Install

From the Chrome Web Store, or unpacked:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Press <kbd>Ctrl</kbd>+<kbd>T</kbd> — Chrome shows a one-time prompt to keep the change; click **Keep it**

After editing any file, hit the reload icon on the extension card in `chrome://extensions`.

## Home screen

Every new tab, reload and browser restart starts at the home screen, so notes never appear on screen by
themselves (handy when sharing the screen). An app opens from its tile or its sidebar icon; the
house button at the top of the sidebar goes back home. The address shows the screen as a route (`#/notes`);
switching screens replaces it instead of adding browser history. An app loads its data when it is first opened.

## Data

One IndexedDB database, `ntab`; the model (stores and fields) is documented at the top of `shared/db.js`.
The same rules everywhere: every record has a uuid `id`, labels are `name`, times are milliseconds in `…At`
fields, order is a numeric `rank`, the sort of a record is `kind`. Every write is one transaction, and every page
of the browser hears about it (BroadcastChannel), so open pages stay in sync.

The **Data** button in the sidebar:

- **Export backup** downloads `ntab-backup-YYYY-MM-DD.json`:
  `{ "app": "ntab", "format": 1, "exportedAt": …, "data": { settings, notes, trackerTypes, trackerEntries, tasks, actions } }`
- **Import backup…** checks the file, shows what is in it and, after a confirm, replaces all data with it
  (other NTab pages reload).
- **Import text files…** adds every picked file as a note named like the file.

When the last backup is a week old (or there was none for a week) and there is something to lose, the home screen
shows a reminder with **Export backup** and **Later** (3 days).

## Notepad

- Double-click the free space of the tab bar to create a note (`new1`, `new2`…). `[+]` lists every note
  (filter, open, delete). With no tabs open the page shows the same list in place of the editor.
- A note's name is any string (`todo`, `todo.md`, `log.txt`); it only matters when the note is downloaded.
  Double-click a tab to rename. Drag tabs to reorder. Middle-click or `×` closes. Right-click → **Download**
  saves the note as a file named exactly like the note; **Delete note** deletes it at once, without asking.
- Closing a tab:
  - not edited since it was opened, or empty — it just closes;
  - edited — a panel asks for the name (first line / current name / anything typed);
  - a new note made here that is still empty — it is deleted.
- Saving: a note is written 300 ms after you stop typing, at least every 2 s while you keep typing, and at once
  when the page is hidden or closed.
- Each new-tab page has its own set of open tabs (kept across reloads and browser restarts); a brand new
  tab opens with the set of the page you were in last. Edits, renames and deletes are synced between pages.
- Status bar: cursor position, length, save state, font size `A− / A+`, word wrap, spaces per Tab.

## Tracker

- An **event type** has an emoji, a name and a kind: an **event** (a tap logs the moment) or an **activity**
  (a tap starts it, **Finish** ends it). **+ new type** adds one: pick the icon from the suggestions or from
  **all emoji…** (every single-character emoji the browser knows, found at runtime, no emoji data shipped, so no
  search), or paste one; **edit types** renames, reorders, switches event ⇄ activity and archives (an archived
  type loses its tile, its entries keep their name in the log).
- A running activity shows on top with its running time, a growing bar and **Finish**.
- The day log below (◀ ▶ today) lists the entries of a day; click a time (the start, or an activity's finish)
  to correct it, `×` deletes. Every log, finish and delete can be undone from the toast.
- An entry is one record: `{ id, typeId, at }` for an event, `{ id, typeId, at, endAt }` for an activity
  (`endAt: null` while it runs).

## Board

Columns New / Work / Hold / Done. **+ task** (or `+` in New) creates a task with a name and a description;
click a card to edit it, change its status or delete it. Drag cards between and within columns (the mouse
anywhere on a card, a finger by its `⋮⋮` handle). A move is one transaction that renumbers the `rank` of the
cards it shifts.

## Actions

One list drives both the home tiles and the sidebar, in the same order. The dashed **+ Add** tile at the end
opens a small dialog for one new link (URL, name — defaults to the host name —, icon upload, new tab); it is
added at the end of the list. Hovering a sidebar icon shows a flyout with its full name and address. Edit with
✎ at the bottom of the sidebar (above it: **Data** and the theme switch auto / light / dark) — a form or raw JSON:

```json
[
  { "id": "…", "name": "Notes", "kind": "open", "options": { "url": "#/notes", "newTab": false } },
  { "id": "…", "name": "Gmail", "kind": "open", "options": { "url": "https://mail.google.com", "newTab": true } }
]
```

An action is a button of some `kind` with its `options`. The only kind so far is `open`: a route `#/<app id>`
opens an app (`#/notes`, `#/tracker`, `#/board`), anything else is a web address. New kinds (a request with its
response, …) are new values of `kind`. Actions of a kind or an app this version doesn't know (from a backup of a
newer version) are kept and not shown. The default list (made on the first start): Notes, Tracker, Board, Gmail,
YouTube. The editor's **+ notepad / + tracker / + task board** buttons add an app that isn't in the list; without
the notepad it shows **add it back** and asks before saving.

Icons: your uploaded icon if any, otherwise Chrome's own favicon cache (sites you've visited in this
profile, no network) or the app's built-in icon, otherwise the first letter. `⤒` in the editor uploads
any image; it is scaled to a 128×128 PNG and kept in the action (`icon`, a data URL).

## Permissions and privacy

- `favicon` — reads action icons from Chrome's local favicon cache.

No host permissions, no network requests, nothing leaves the browser except the backups you export.

## Publishing

`npm run release` builds the package, store texts and screenshots into `ignore/publish/`; see
[PUBLISHING.md](PUBLISHING.md).

## Files

Sources are plain ES modules, split by role:

- `manifest.json` — MV3; `chrome_url_overrides.newtab`, permission `favicon`
- `newtab.html` — the page: shell, the screens of all apps, dialogs
- `icons/` — `icon.svg` (source, also the page favicon) and the PNG sizes for the manifest
- `platform/` — the only place that calls `chrome.*` (the favicon cache); `index.js` picks the platform
- `shared/` — code every part uses:
  - `base.css` — theme tokens, controls, dialogs
  - `db.js` — the database: the data model, transactions, change events, backup dump and restore
  - `settings.js` — settings
  - `util.js` — DOM helpers, formatting, drag-to-reorder, routes, downloads
- `shell/` — the frame around the apps:
  - `main.js` — entry point: theme, screens
  - `apps.js` — the app registry and the app contract
  - `view.js` — current screen (home / an app id) and its route
  - `actions.js`, `sidebar.js`, `home.js` — the actions and their icons, the sidebar with its flyout, home tiles
  - `actions-dialog.js`, `add-link.js`, `icon-file.js` — the actions editor, the + Add dialog, icon upload
  - `data.js` — the Data dialog (backup export / import, text files) and the backup reminder
  - `theme.js` — applies the saved theme before the first paint
- `apps/notes/` — `index.js` (the app), `notes.js` (open notes, autosave, session, cross-page sync),
  `editor.js`, `tabbar.js`, `dialogs.js`
- `apps/tracker/` — `index.js` (UI), `model.js` (types, entries, activities)
- `apps/board/` — `index.js` (UI, drag and drop), `model.js` (tasks)
- `store/`, `scripts/release.mjs` — store listing sources and the release builder
- `test/` — headless Chrome harness (`chrome.*` stub, CDP helpers; smoke, notes, tracker, board and data tests);
  not part of the package
