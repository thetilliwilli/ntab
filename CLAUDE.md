# CLAUDE.md

Notes for Claude Code sessions on this repo. Read README.md for features and the file map, PUBLISHING.md for
store releases, the header comment of `apps/notes/notes.js` for the save/draft/session model, and
`shell/apps.js` for the app contract.

## The user

- Speaks Russian: answer in Russian. Code, comments, UI text, commit messages and docs stay in English.
- Priorities: the user's own productivity and speed come first; strict, square, minimal design.

## Working rules

- CLAUDE.md holds only lasting rules and decisions. Plans, ideas and temporary notes go to BACKLOG.md.
- Commit to `master` after each finished change (no need to ask). Push to `origin`
  (https://github.com/thetilliwilli/ntab, public) only when asked.
- Verify changes in the headless test harness (see Testing) before committing; check screenshots for visual work.
- No npm dependencies, no build step, no frameworks. `package.json` exists only for `npm run release`.
- Before publishing anything outward (store, GitHub settings, …) confirm with the user.

## Product decisions (don't undo without asking)

- Chrome Web Store: the live version, its permissions and commit are in `store/published.json` (the user runs
  `npm run release:done` after publishing). Releases: `npm run release` (see PUBLISHING.md); the user uploads by hand.
- When a user-visible feature changes, update `store/description.txt` (feature list and WHAT'S NEW) in the
  same commit, and `store/demo.mjs` / the scenes in `scripts/release.mjs` if the screenshots would be wrong.
- Store screenshots and promo tiles share one style: light theme only.
- Extension name: "NTab: Notepad New Tab" (`short_name` "NTab"; was "Custom New Tab" in v1). "New tab" and
  "notepad" are in the name for store search; no keyword stuffing. Page title: "new" on the home
  screen, the app's name in an app (`shell/main.js`).
- Favicon and extension icon: blue "N" in a square frame, `icons/icon.svg` (source) → `icon-16/32/48/128.png` (rendered with
  `magick -background none -density 1152 icons/icon.svg -resize NxN PNG32:icons/icon-N.png`).
- No migrations of settings: the v1 shortcuts migration was removed on purpose; existing users' saved lists don't
  get new actions automatically (only `DEFAULT_LINKS` starts with Notes, Tracker, Board; the editor has
  "+ <app>" buttons, "add it back" for the notepad and warns when saving without it). The user explicitly
  declined these migrations.
- The one exception, chosen by the user for 2.2.0: a data folder from 2.1 or older (files in its root, no
  `ntab.json`) gets a gate that moves the files into `notes/` on a click (`shared/folder.js`).
- Apps: notes, tracker, board (`apps/<id>/`, registered in `shell/apps.js`). The extension name stays
  "NTab: Notepad New Tab". Data folder layout: the root has only `ntab.json`; every app has its own subfolder.
- Tracker decisions: event = `{id, type, time}`, activities add `activity` (uuid) and `phase: "start"|"end"`;
  types have an immutable slug id and an emoji icon; types are archived (`archived: true`), never deleted;
  undo toast, day log with time edit.
- Board: fixed columns new / work / hold / done; drag on pointer events (works with touch), status also in the
  task dialog.
- No keyboard shortcuts (hotkeys) for now.
- No warning for large files.
- Theme colors stay our own tokens: Chrome has no API to read its theme colors (only light/dark is known);
  matching the default Chrome palette was offered and declined.
- Home screen: every page load (new tab, reload, restart) starts at home, so notes never show by themselves
  (screen sharing). Switching screens adds no history entries and isn't stored. The data folder is only
  touched when an app that needs it is first opened on the page.
- One action list drives both the home tiles and the sidebar. Home groups it into "Apps" and "Links";
  the sidebar keeps the list order. The "+ Add" tile (last in Links) opens the one-link dialog (`#add`), not
  the full editor (✎). Action = link `{name, url, target?}` or app `{type: <app id>, name}`; unknown app ids
  (a newer version on another machine) are hidden and kept. Uploaded icons are 128×128 PNG, keyed by hostname
  or app id.
- Sidebar: always narrow (60px), icons 32px, hover flyout with name + URL, arrows at the top/bottom edge when
  icons are cut off. Home button on top; theme toggle (auto → light → dark) and ✎ (actions editor) at the bottom.
- Tab right-click menu has one item, "Delete file": deletes file + tab immediately, no confirmation (choosing it
  is the confirmation). The × in the `[+]` file list keeps its `confirm()` (small target, easy to misclick).
  Deletion is permanent; a `.trash/` folder was offered and not requested.
- Closing a tab: untouched or empty → just closes; edited → close panel asks for a name; an empty note created
  here (`created` flag) also has its file deleted. Files opened from the folder are never deleted by closing.

## Code notes

- Structure: `platform/` is the only place with `chrome.*`; `shared/` is used by everything; `shell/` is the frame
  (gate, screens, sidebar, home, actions editor); `apps/<id>/` holds an app with its own CSS. An app's screen is
  `#app-<id>` in `newtab.html`; ids of its elements share a prefix (`tr-`, `bd-`).
- MV3 CSP forbids inline scripts → `shell/theme.js` is a classic script in `<head>` that applies the saved theme
  from `localStorage` before first paint.
- `[hidden] { display: none !important; }` is global, and `border-radius: 0 !important` on everything.
- Storage layout is documented at the top of `shared/settings.js`, the data folder at the top of
  `shared/folder.js`; `chrome.storage.sync` keys `links.n`/`links.<i>` and `settings` must stay readable (users
  keep their data across updates).
- Folder handle and a random folder id (`dirId`) live in IndexedDB (`shared/idb.js`). Drafts are
  `draft:<dirId>:<name>` in `storage.local`; BroadcastChannel `newtab-notes` messages carry `dir` and foreign
  ones are ignored.
- Editor performance: the textarea value is cached in `editor.js`; in wrap mode line heights are measured on a
  hidden mirror, cached per line text, and only visible gutter numbers are drawn. Keep typing cost low on big
  files (about 16 ms per keystroke on a large file was the last measurement).
- The tab bar updates in place (rebuilds only when the order changes). Drag-reorder uses `sortable()` in `util.js`.
- `views` in notes.js = per-tab cursor/scroll; `onScroll` saves it. `shell/view.js` is the screen state (home / app id).
- Tracker and board write their files under Web Locks (`ntab-tracker`, `ntab-board`) and tell other pages over
  BroadcastChannel (`newtab-tracker`, `newtab-board`, scoped by `dir` like notes).

## Testing

No test framework. `test/` holds a headless-Chrome harness driven over the DevTools protocol (raw CDP; Playwright/Puppeteer/browser MCP
were considered and declined, keep it dependency-free):

- `test/stub.js` mocks `chrome.storage` (backed by `localStorage` keys `stub:local` / `stub:sync`),
  `chrome.runtime`, and maps `showDirectoryPicker()` to the OPFS folder `notes` (= the data folder; notes are in
  its `notes/` subfolder).
- `test/run.sh [dir]` copies the sources into `dir` (default `/tmp/newtab-test`), makes `test.html` (newtab.html
  with `stub.js` injected before `main.js`), serves it on `localhost:8765` and starts headless Chrome with CDP on
  port 9333. Re-run the copy after editing sources (or kill the server/Chrome and run it again).
- `test/cdp.mjs` has helpers (`newPage`, `ev`, `type`, `click`, `shot`, `ok`, `dataDir`, `notesDir`, `clearData`,
  `setActions`, `openApp`); `test/example.mjs` is a smoke test, `test/tracker.mjs` and `test/board.mjs` cover the
  apps (`node test/<name>.mjs`, `SHOTS=dir` for screenshots; Node 22+ for the global WebSocket).
- Pages start at home; click `#links .<app id>` (or `openApp(P, id)`, which also passes the gate) to open an
  app. Use two pages for cross-tab sync tests. Favicons from `_favicon/` don't exist outside the extension, so icons fall back to
  letters in the harness.
- Scenarios covered so far by throwaway scripts (rewrite as needed): autosave delay and max-wait, cross-page
  `saved`/`rename`/`deleted` sync, drafts on failed writes and their rescue on start, foreign-folder messages
  ignored, empty-note deletion rules, close panel, rename, drag reorder (tabs and actions), wrap gutter alignment
  and typing speed, home screen (no folder access, no file names), flyout, theme cycle and persistence, actions
  editor (type switch, add it back, save warning, JSON validation), sidebar wheel scroll under the flyout and
  edge arrows, tab right-click delete (incl. right after typing, no resurrection after reload), data folder
  upgrade (move and copy fallback, name clash in notes/), actions editor with apps (add buttons, unknown types).
- Known flaky: a timing race in an old two-page sync test, not a product bug.