# Publishing an update to the Chrome Web Store

Dashboard: https://chrome.google.com/webstore/devconsole → the extension.

## 1. Bump the version

In `manifest.json` raise `"version"` above the one live in the store (the store rejects equal or lower):

- `2.0.0` → `2.0.1` for fixes
- `2.0.0` → `2.1.0` for new features
- `2.0.0` → `3.0.0` for big changes

Commit everything.

## 2. Build the package

```sh
npm run pack
```

Creates `newtab.zip` with only the extension files (`manifest.json`, `newtab.html`, `newtab.css`, `js/`, `icons/`)
and lists them. It is built from the last commit and refuses to run with uncommitted changes.
`newtab.zip` is git-ignored.

## 3. Upload

Dashboard → **Package** → **Upload new package** → `newtab.zip`.

## 4. Check the other tabs (only if something changed)

- **Store listing** — description, screenshots (1280×800 or 640×400), store icon 128×128
  (`icons/icon-128.png`). Update when features or the look changed.
- **Privacy** — if `permissions` in `manifest.json` changed, add a justification for each new one.
  Current ones:
  - `storage`: Saves settings, shortcuts, open tabs and unsaved drafts.
  - `favicon`: Shows website icons for the user's shortcuts from Chrome's local favicon cache.
  - Single purpose: Replaces the new tab page with a home screen of shortcuts and a plain-text notepad.
  - Remote code: No. Data usage: collects nothing.

## 5. Submit

**Submit for review** (optionally tick **Defer publish** to publish by hand after approval).
Review takes from a few hours to a few days; the dashboard shows the status and emails the result.

After publishing, installed copies update by themselves within hours. To update at once:
`chrome://extensions` → Developer mode → **Update**.

## Before changing storage or permissions

- A new permission with a warning disables the extension for existing users until they accept it.
- Users keep the data of the previous version: if a storage key or format changes, the new version has to
  read the old one (migrate), or their shortcuts/settings are lost.
