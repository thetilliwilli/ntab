# CLAUDE.md

Notes for Claude Code sessions on this repo. Read README.md for features and the file map, PUBLISHING.md for
store releases, and the header comment of `js/notes.js` for the save/draft/session model.

## The user

- Speaks Russian: answer in Russian. Code, comments, UI text, commit messages and docs stay in English.
- Linux (Fedora), Google Chrome (`google-chrome`, v155 at the time of writing).
- Priorities: the user's own productivity and speed come first; strict, square, minimal design.

## Working rules

- Commit to `master` after each finished change (no need to ask). Push to `origin`
  (https://github.com/thetilliwilli/ntab, public) only when asked.
- Verify changes in the headless test harness (see Testing) before committing; check screenshots for visual work.
- No npm dependencies, no build step, no frameworks. `package.json` exists only for `npm run pack`.
- Before publishing anything outward (store, GitHub settings, …) confirm with the user.

## Product decisions (don't undo without asking)

- Chrome Web Store: v1 `1.0.0` is live. Local version is `2.0.0` and has NOT been published yet; there were big
  changes since (home screen etc.), so bump to `2.1.0`/`3.0.0` when publishing (see PUBLISHING.md).
- Extension name stays "Custom New Tab". Page `<title>` is `newtab`. Favicon and extension icon: blue "N" in a
  square frame, `icons/icon.svg` (source) → `icon-16/32/48/128.png` (rendered with
  `magick -background none -density 1152 icons/icon.svg -resize NxN PNG32:icons/icon-N.png`).
- No migrations: the v1 shortcuts migration was removed on purpose; existing users' saved lists don't get the
  notepad action automatically (only `DEFAULT_LINKS` starts with it; the editor offers "add it back" and warns
  when saving without it). The user explicitly declined both migrations.
- No keyboard shortcuts (hotkeys) for now.
- No warning for large files.
- Home screen: every page load (new tab, reload, restart) starts at home, so notes never show by themselves
  (screen sharing). Switching home ⇄ notepad adds no history entries and isn't stored. The notes folder is only
  touched when the notepad is first opened on the page.
- One action list drives both the home tiles and the sidebar. Action = link `{name, url, target?}` or notepad
  `{type: "notes", name}`. Uploaded icons are 128×128 PNG, keyed by hostname or `"notes"`.
- Sidebar: always narrow (60px), icons 32px, hover flyout with name + URL, arrows at the top/bottom edge when
  icons are cut off. Home button on top; theme toggle (auto → light → dark) and ✎ (actions editor) at the bottom.
- Tab right-click menu has one item, "Delete file": deletes file + tab immediately, no confirmation (choosing it
  is the confirmation). The × in the `[+]` file list keeps its `confirm()` (small target, easy to misclick).
  Deletion is permanent; a `.trash/` folder was offered and not requested.
- Closing a tab: untouched or empty → just closes; edited → close panel asks for a name; an empty note created
  here (`created` flag) also has its file deleted. Files opened from the folder are never deleted by closing.

## Code notes

- MV3 CSP forbids inline scripts → `js/theme.js` is a classic script in `<head>` that applies the saved theme
  from `localStorage` before first paint.
- `[hidden] { display: none !important; }` is global, and `border-radius: 0 !important` on everything.
- Storage layout is documented at the top of `js/settings.js`; `chrome.storage.sync` keys `links.n`/`links.<i>`
  and `settings` must stay readable (users keep their data across updates).
- Folder handle and a random folder id (`dirId`) live in IndexedDB (`js/idb.js`). Drafts are
  `draft:<dirId>:<name>` in `storage.local`; BroadcastChannel `newtab-notes` messages carry `dir` and foreign
  ones are ignored.
- Editor performance: the textarea value is cached in `editor.js`; in wrap mode line heights are measured on a
  hidden mirror, cached per line text, and only visible gutter numbers are drawn. Keep typing cost low on big
  files (about 16 ms per keystroke on a large file was the last measurement).
- The tab bar updates in place (rebuilds only when the order changes). Drag-reorder uses `sortable()` in `util.js`.
- `views` in notes.js = per-tab cursor/scroll; `onScroll` saves it. `js/view.js` is the home/notepad screen state.

## Testing

No test framework. `test/` holds a headless-Chrome harness driven over the DevTools protocol:

- `test/stub.js` mocks `chrome.storage` (backed by `localStorage` keys `stub:local` / `stub:sync`),
  `chrome.runtime`, and maps `showDirectoryPicker()` to the OPFS folder `notes`.
- `test/run.sh [dir]` copies the sources into `dir` (default `/tmp/newtab-test`), makes `test.html` (newtab.html
  with `stub.js` injected before `main.js`), serves it on `localhost:8765` and starts headless Chrome with CDP on
  port 9333. Re-run the copy after editing sources (or kill the server/Chrome and run it again).
- `test/cdp.mjs` has helpers (`newPage`, `ev`, `type`, `click`, `shot`, `ok`, `notesDir`);
  `test/example.mjs` is a smoke test (`node test/example.mjs`, Node 22+ for the global WebSocket).
- Pages start at home; click `#links .notes` (or call `setView("notes")`) to open the notepad. Use two pages
  for cross-tab sync tests. Favicons from `_favicon/` don't exist outside the extension, so icons fall back to
  letters in the harness.
- Scenarios covered so far by throwaway scripts (rewrite as needed): autosave delay and max-wait, cross-page
  `saved`/`rename`/`deleted` sync, drafts on failed writes and their rescue on start, foreign-folder messages
  ignored, empty-note deletion rules, close panel, rename, drag reorder (tabs and actions), wrap gutter alignment
  and typing speed, home screen (no folder access, no file names), flyout, theme cycle and persistence, actions
  editor (type switch, add it back, save warning, JSON validation), sidebar wheel scroll under the flyout and
  edge arrows, tab right-click delete (incl. right after typing, no resurrection after reload).
- Known flaky: a timing race in an old two-page sync test, not a product bug.

## Open questions (user hasn't decided)

- Git history is public and contains the author email of all commits and an old icon source
  `art/space-tab-icon.webp` (removed from the tree, still in history). The user was told; nothing rewritten.
- No LICENSE file (MIT was suggested).
- Store listing screenshots are outdated (no home screen). Store description draft for the next release:

```
A calm new tab page: a home screen of big action tiles and a tabbed plain-text notepad.

HOME SCREEN
Every new tab opens on a home screen of large square tiles — your sites and the notepad. Your notes never appear on screen by themselves, so it is safe to open a new tab while sharing your screen or streaming. Switching between screens adds nothing to the browser history.

SIDEBAR
A narrow bar on the left with the same actions as icons. Hover an icon to see its full name and URL. At the top — Home, at the bottom — the theme switch (auto / light / dark) and the actions editor.

NOTEPAD
• Notes are plain text files in a local folder you choose — open them in any other editor too.
• Tabs like Notepad++: double-click the tab bar for a new note, double-click a tab to rename the file, drag to reorder, right-click to delete.
• Saved as you type. If the page closes before a write finishes, the text is kept as a draft and written on the next start.
• Open tabs survive reloads and browser restarts; each new-tab page keeps its own set, synced with the others.
• Line numbers, word wrap, font size, tab width, light and dark themes.
• Fast with big files.

ACTIONS
Edit the list in a form or as raw JSON. Each action is a link or the notepad. Icons come from Chrome's own favicon cache, or upload your own. The list follows your Chrome profile through sync.

PRIVACY
No accounts, no servers, no network requests, no tracking. Notes stay in your folder; settings stay in your browser.
```
