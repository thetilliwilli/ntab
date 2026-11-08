# NTab: Notepad New Tab

Chrome extension that replaces the new tab page (Ctrl+T, `+` button, `chrome://newtab`) with a home
screen of large action tiles and a narrow sidebar with the same actions. Actions are links and apps:

- **Notes** — a tabbed plain-text notepad (think Notepad++), saved as you type, open tabs survive restarts;
- **Tracker** — tap a tile to log that something happened (smoked, workout, called mom…), or start an
  activity that runs until you finish it;
- **Board** — a kanban board: tasks in New / Planned / Work / Hold / Done.

All data lives in the browser (IndexedDB) and works offline; your own small server can sync it between your devices
in real time (optional, see [Sync server](#sync-server)); a backup is one JSON file. No dependencies, no build step.
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
- Its data is its own (another origin than the extension): move it with a backup, or connect both to the sync server.
  The page asks the browser to keep its storage persistent.
- Offline: `sw.js` caches every file per version and starts from the cache. `VERSION` and `FILES` in it are
  generated: run `node scripts/sw.mjs` after changing any file (`--check` tells whether it is stale; `test/web.mjs`
  checks it). A new version is downloaded in full in the background. The page looks for one whenever it comes back to the
  screen (an installed app on a phone is resumed, not reloaded) and reloads into it at the first safe moment: at once
  on the home screen, otherwise on going home or leaving the app; meanwhile a bar offers **Reload**
  (`shell/update.js`).
- The origin `thetilliwilli.github.io` is shared by every Pages site of the account: any of them could read this data.

## Home screen

Every new tab, reload and browser restart starts at the home screen, so notes never appear on screen by
themselves (handy when sharing the screen). An app opens from its tile or its sidebar icon; the
house button at the top of the sidebar goes back home. The address shows the screen as a route (`#/notes`);
switching screens replaces it instead of adding browser history. The top right corner of the home screen links to
the GitHub repository and shows the version (`manifest.json`; the web version adds its build, the id of the cached file
set, so you can tell whether a phone has the latest). An app loads its data when it is first opened.

## Data

One IndexedDB database, `ntab2` (data model 2); the model (stores and fields) is documented at the top of
`shared/db.js`. The same rules everywhere: every record of every store has a uuid `id` and `updatedAt` (its last
change), labels are `name`, times are milliseconds in `…At` fields, order is a numeric `rank` (fractional: moving a
record changes only that record), the sort of a record is `kind`. Synced and backed up: `notes`, `trackerTypes`,
`trackerEntries`, `tasks`, `actions`, `settings` (one record per setting); this browser only: `device` (the open note
tabs, the backup reminder, the sync server) and `outbox` (changes the sync server hasn't got yet). Every write is one
transaction, and every page of the browser hears about it (BroadcastChannel), so open pages stay in sync.

The **Data** button in the sidebar (a small square on it: green = synced, red = the sync server can't be reached):

- **Sync server** — see [Sync server](#sync-server).
- **Export backup** downloads `ntab-backup-YYYY-MM-DD.json`:
  `{ "app": "ntab", "format": 2, "exportedAt": …, "data": { notes, trackerTypes, trackerEntries, tasks, actions, settings } }`
- **Import backup…** checks the file and adds what this browser doesn't have yet (by id): nothing is deleted or
  changed, a record that is here already stays as it is (the untouched default actions give way to the backup's). To
  restore a backup exactly: **Delete all data…**, then import it. Backups of NTab 2.2 (format 1): see
  [From NTab 2.2](#from-ntab-22).
- **Import text files…** adds every picked file as a note named like the file.
- **Delete all data…** deletes everything NTab keeps in this browser (the database, the 2.2 database, the cached
  theme) after a confirm and starts fresh with the default actions; other NTab pages reload. The sync server keeps
  its data.

When the last backup is a week old (or there was none for a week) and there is something to lose, the home screen
shows a reminder with **Export backup** and **Later** (3 days).

## Sync server

Optional: one small server of your own (`server/ntab-server.mjs`, Node 22.13+, no dependencies; not part of the
extension or the web version) that all your NTab clients sync with: the extension on each computer, the web version
on a phone, a plain browser tab. A change on one shows on the others within a second: start an activity on the
laptop, finish it on the phone. A client works the same without it (offline, the server down, or no server set
yet): its changes wait and go when it connects, whatever piled up meanwhile.

1. **A certificate**, once. The server speaks only HTTPS, so nobody between a device and the server can read or change
   the traffic. Make a self-signed certificate for the address the devices will use (a LAN IP, a domain, or both:
   `subjectAltName=IP:192.168.1.10,DNS:my.domain.com`):

   ```
   openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=ntab" -addext "subjectAltName=IP:192.168.1.10" -keyout ntab-key.pem -out ntab-cert.pem
   ```

   `ntab-key.pem` stays on the server and with nobody else. Another address needs another certificate.
2. **Run** it (the port open in the firewall; Fedora: `sudo firewall-cmd --permanent --add-port=8443/tcp && sudo firewall-cmd --reload`):

   ```
   node server/ntab-server.mjs --token <secret> --listen 0.0.0.0:8443 --cert ntab-cert.pem --key ntab-key.pem --data ./ntab-data
   ```

   - `--token` — 16+ characters (e.g. `openssl rand -hex 24`: letters and digits keep the address simple). Every
     request must carry it (HTTP basic auth, as the user or the password); a CORS preflight is the only exception.
   - `--listen ip:port` — default `127.0.0.1:8443` (this computer only); `0.0.0.0:8443` for every network.
   - `--origin` — the pages allowed to call the server, comma separated, or `*` (the default), e.g.
     `chrome-extension://<extension id>,https://thetilliwilli.github.io`. Browsers only: the token is what keeps the
     rest out.
   - `--data` — where its SQLite database lives (default `./ntab-data`).

   It prints the certificate's SHA-256 fingerprint to compare with what a device shows.
3. **Trust the certificate** on every device, once (without it browsers refuse the connection, and clicking through a
   warning would accept anyone's certificate):
   - Chrome on a computer: `chrome://certificate-manager` → Local certificates → Custom → Import `ntab-cert.pem`,
     trusted for websites.
   - Android: Settings → Security & privacy → More security settings → Encryption & credentials → Install a
     certificate → CA certificate → `ntab-cert.pem`.

   Check: `https://192.168.1.10:8443/` opens without a warning and, given the token as the password, says
   "NTab sync server: OK".
4. **Connect** each client: **Data → Sync server** `https://<token>@192.168.1.10:8443` → **Connect**. When both the
   server and the client have data, choose **Merge** (both sets) or **Replace this device** (the client's data goes,
   the server's comes). A page on a public site (the web version) reaching a LAN address asks once for access to the
   local network: allow it.

How it syncs (`shared/sync.js`, `server/ntab-server.mjs`): while a server is set, every change made here also goes to
the `outbox` (deletes too). The server gives every accepted change the next number (`rev`); a client pulls what is
newer than the last number it saw, pushes its outbox, and keeps a stream open (`/events`) that says when to pull
again. The newer `updatedAt` always wins (two devices edited one note offline: the later edit stays). One page per
browser does the syncing; the others get the changes like any other change. **Disconnect** pauses: changes wait in
the outbox until **Connect**. A server whose database is replaced is a new server for the clients: they send
everything again.

### From NTab 2.2

2.2's data (the database `ntab`, backups of format 1) is not read by this version; it stays in the browser untouched.
Export a backup on every device while it runs 2.2, then on a computer:

```
node scripts/migrate-backup.mjs laptop.json phone.json -o merged.json
```

It joins the files into one backup of format 2 (records with the same id become one, the newer wins; the first file's
order of lists and settings come first) and prints what it did. After the update, import `merged.json` on one device
(**Data → Import backup**), connect it to the server, then connect the others with **Replace this device**.

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
- **edit types → Delete all log entries…** empties the log after a confirm (the types stay; undo from the toast),
  e.g. on a second device that got the types from a backup.
- An entry is one record: `{ id, typeId, at, updatedAt }` for an event, `{ id, typeId, at, endAt, updatedAt }` for an
  activity (`endAt: null` while it runs).

## Board

Columns New / Planned / Work / Hold / Done. **+ task** (or `+` in New) creates a task with a name and a description;
click a card to edit it, change its status or delete it. Drag cards between and within columns (the mouse
anywhere on a card, a finger by its `⋮⋮` handle). A move changes only the moved card: its `rank` goes between its new
neighbours.

## Actions

One list drives both the home tiles and the sidebar, in the same order. The dashed **+ Add** tile at the end
opens the action form for a new action of any kind (URL, name — defaults to the host or app name —, icon upload,
new tab or the request's method, headers as `Name: value` lines and body); it is added at the end of the list.
In the editor, ⚙ (or the method button) on a row opens the same form for that row. Right-click a tile or a
sidebar icon → **Edit** (the same form) or **Delete** (at once, without asking). Hovering a sidebar icon shows a flyout with its full name and address; when the icons don't fit, arrows above and below them scroll by a page. In the editor, **Embed icons** stores every
favicon the browser has cached for your sites in the actions (so a backup carries them, e.g. to the web version,
which has no favicon cache), **Reset icons** sets every action back to its automatic icon, ↺ on a row only that one; **Save** keeps them. Edit with
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

No network requests except the request actions you create and the sync server you set (your own); nothing else
leaves the browser except the backups you export.

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
  - `db.js` — the database: the data model, transactions, change events, the outbox, backup dump and restore
  - `model.js` — fixed ids (default actions, settings, device records) and fractional ranks; node scripts use it too
  - `sync.js` — the sync with the sync server
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
  - `data.js` — the Data dialog (sync server, backup export / import, text files) and the backup reminder
  - `theme.js` — applies the saved theme before the first paint
  - `update.js` — the web version: reloads into a new version at a safe moment
- `apps/notes/` — `index.js` (the app), `notes.js` (open notes, autosave, session, cross-page sync),
  `editor.js`, `tabbar.js`, `dialogs.js`
- `apps/tracker/` — `index.js` (UI), `model.js` (types, entries, activities)
- `apps/board/` — `index.js` (UI, drag and drop), `model.js` (tasks)
- `server/ntab-server.mjs` — the sync server (see Sync server); not part of the package or the web version
- `scripts/migrate-backup.mjs` — 2.2 backups (format 1) to one backup of format 2
- `store/`, `scripts/release.mjs` — store listing sources and the release builder
- `test/` — headless Chrome harness (`chrome.*` stub, CDP helpers; smoke, notes, tracker, board, data, request,
  sync, web and real-extension tests);
  not part of the package
