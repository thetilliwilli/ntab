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

## Web version

The same code runs as a plain web page (a PWA) on GitHub Pages: https://thetilliwilli.github.io/ntab/ —
open it in any browser, or install it as an app (the install icon in Chrome's address bar). Pages serves the
`master` branch as it is (`.nojekyll` keeps the files untouched), so a push deploys it.

- `platform/web.js` stands in for the extension: no favicon cache (tiles show letters or uploaded icons), and no
  access to other sites, so request actions work only with servers that allow CORS (and only `https://` ones).
- Its data is its own (another origin than the extension): move it with a backup. The page asks the browser to keep
  its storage persistent.
- Offline: `sw.js` caches every file per version and starts from the cache. `VERSION` and `FILES` in it are
  generated: run `node scripts/sw.mjs` after changing any file (`--check` tells whether it is stale; `test/web.mjs`
  checks it). A new version is downloaded in full in the background and is used from the next load.
- The origin `thetilliwilli.github.io` is shared by every Pages site of the account: any of them could read this data.

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
opens the action form for a new action of any kind (URL, name — defaults to the host or app name —, icon upload,
new tab or the request's method, headers as `Name: value` lines and body); it is added at the end of the list.
In the editor, ⚙ (or the method button) on a row opens the same form for that row. Right-click a tile or a
sidebar icon → **Edit** (the same form) or **Delete** (at once, without asking). Hovering a sidebar icon shows a flyout with its full name and address. Edit with
✎ at the bottom of the sidebar (above it: **Data** and the theme switch auto / light / dark) — a form or raw JSON:

```json
[
  { "id": "…", "name": "Notes", "kind": "open", "options": { "url": "#/notes", "newTab": false } },
  { "id": "…", "name": "Gmail", "kind": "open", "options": { "url": "https://mail.google.com", "newTab": true } }
]
```

An action is a button of some `kind` with its `options`:

- `open` `{ url, newTab }` — a route `#/<app id>` opens an app (`#/notes`, `#/tracker`, `#/board`), anything else
  is a web address;
- `request` `{ url, method, headers, body, render }` — sends an HTTP request and shows the response in a window:
  status, time, type, size and two tabs. **render** (the default) shows what `render` returns: a JavaScript
  function as text of `w`, a window-like object: `w.document` is the response parsed as a page (DOMParser: its
  scripts don't run, nothing loads), `w.text` the body as it came, `w.json` the body as JSON, `w.url`. E.g.
  `w => w.document.querySelector("table").outerHTML`, `w => w.document.links.length`, `w => w.json.ip`,
  ``w => `<h1>${w.document.title}</h1>` ``. An element (or a list) is shown as its HTML, a string with tags as
  HTML, anything else as text; returning `w` shows the body. New requests get `w => w.text`. **raw** has the
  response headers (folded) and the body as text, JSON pretty-printed (binary bodies are only described).
  **Repeat**, **Copy** (of the open tab), **Cancel**, a 30 s timeout. `headers` is `{ "Name": "value" }`, `body` a
  string (not sent with GET and HEAD).

  MV3 lets only a sandboxed page evaluate code from a string, so the function runs in `shell/render.html`
  (`"sandbox"` in the manifest; not a permission): an iframe with its own origin, no `chrome.*` and no access to
  the extension's data, links open in a new tab. (A real window with the response would need a frame inside that
  frame, and a frame inside a sandboxed page gets an origin of its own, out of reach; hence DOMParser.)

  Without a host permission the browser applies CORS, so only services that allow it answer (e.g.
  `https://api.ipify.org?format=json`). When a request fails that way, the window offers **Allow access to
  <site>**: an optional host permission for that one site (`optional_host_permissions` in the manifest, so
  nothing is asked at install), then sends it again.

New features of this sort are new values of `kind`. Actions of a kind or an app this version doesn't know (from a backup of a
newer version) are kept and not shown. The default list (made on the first start): Notes, Tracker, Board, Gmail,
YouTube. The editor's **+ notepad / + tracker / + task board** buttons add an app that isn't in the list; without
the notepad it shows **add it back** and asks before saving.

Icons: your uploaded icon if any, otherwise Chrome's own favicon cache (sites you've visited in this
profile, no network) or the app's built-in icon, otherwise the first letter. `⤒` in the editor uploads
any image; it is scaled to a 128×128 PNG and kept in the action (`icon`, a data URL).

## Permissions and privacy

- `favicon` — reads action icons from Chrome's local favicon cache.
- optional host permissions — asked for one site at a time, only when a request action of yours needs it.

No network requests except the request actions you create; nothing else leaves the browser except the backups
you export.

## Publishing

`npm run release` builds the package, store texts and screenshots into `ignore/publish/`; see
[PUBLISHING.md](PUBLISHING.md).

## Files

Sources are plain ES modules, split by role:

- `manifest.json` — MV3; `chrome_url_overrides.newtab`, permission `favicon`, optional host permissions
- `newtab.html` — the page: shell, the screens of all apps, dialogs
- `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll` — the web version only (see Web version); `scripts/sw.mjs`
  writes the file list and version into `sw.js`
- `icons/` — `icon.svg` (source, also the page favicon) and the PNG sizes for the manifest; `icon-192/512.png` and
  `icon-maskable.svg` → `icon-maskable-512.png` for the web app
- `platform/` — the only place that calls `chrome.*`: `extension.js`, `web.js` (the web version); `index.js` picks
  one at runtime
- `shared/` — code every part uses:
  - `base.css` — theme tokens, controls, dialogs
  - `db.js` — the database: the data model, transactions, change events, backup dump and restore
  - `settings.js` — settings
  - `util.js` — DOM helpers, formatting, drag-to-reorder, routes, downloads
  - `menu.js` — the right-click menu (tabs, tiles, sidebar icons)
- `shell/` — the frame around the apps:
  - `main.js` — entry point: theme, screens
  - `apps.js` — the app registry and the app contract
  - `view.js` — current screen (home / an app id) and its route
  - `actions.js`, `sidebar.js`, `home.js` — the actions and their icons, the sidebar with its flyout, home tiles
  - `actions-dialog.js`, `action-form.js`, `icon-file.js` — the actions editor, the form for one action (+ Add, ⚙), icon upload
  - `request.js` — runs request actions and shows the response
  - `render.html`, `render-frame.js` — the sandboxed frame that runs a request's render function
  - `data.js` — the Data dialog (backup export / import, text files) and the backup reminder
  - `theme.js` — applies the saved theme before the first paint
- `apps/notes/` — `index.js` (the app), `notes.js` (open notes, autosave, session, cross-page sync),
  `editor.js`, `tabbar.js`, `dialogs.js`
- `apps/tracker/` — `index.js` (UI), `model.js` (types, entries, activities)
- `apps/board/` — `index.js` (UI, drag and drop), `model.js` (tasks)
- `store/`, `scripts/release.mjs` — store listing sources and the release builder
- `test/` — headless Chrome harness (`chrome.*` stub, CDP helpers; smoke, notes, tracker, board, data, request,
  web and real-extension tests);
  not part of the package
