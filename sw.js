/* service worker of the web version (GitHub Pages): the whole app is cached per version, served from the cache
   (instant start, offline). a new version (VERSION changes with any file) is downloaded in full in the background
   and takes over at once; open pages keep the files they loaded (all modules load at start), the next load gets
   the new set, never a mix. VERSION and FILES are written by `node scripts/sw.mjs` (`--check` fails if stale).
   the origin (thetilliwilli.github.io) is shared with other Pages sites: only our own "ntab-" caches are touched */

// generated: start
const VERSION = "22e00a5ef71d";
const FILES = [
  "./",
  "index.html",
  "newtab.html",
  "manifest.webmanifest",
  "apps/board/board.css",
  "apps/board/index.js",
  "apps/board/model.js",
  "apps/notes/dialogs.js",
  "apps/notes/editor.js",
  "apps/notes/index.js",
  "apps/notes/notes.css",
  "apps/notes/notes.js",
  "apps/notes/tabbar.js",
  "apps/tracker/index.js",
  "apps/tracker/model.js",
  "apps/tracker/tracker.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon-maskable.svg",
  "icons/icon.svg",
  "platform/index.js",
  "platform/web.js",
  "shared/base.css",
  "shared/db.js",
  "shared/menu.js",
  "shared/settings.js",
  "shared/util.js",
  "shell/action-form.js",
  "shell/actions-dialog.js",
  "shell/actions.js",
  "shell/apps.js",
  "shell/data.js",
  "shell/home.js",
  "shell/icon-file.js",
  "shell/main.js",
  "shell/render-frame.js",
  "shell/render.html",
  "shell/request.js",
  "shell/shell.css",
  "shell/sidebar.js",
  "shell/theme.js",
  "shell/view.js",
];
// generated: end

const CACHE = `ntab-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // "reload": past the HTTP cache (Pages lets it keep files for 10 minutes), so a version never gets old files
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ntab-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((r) => r || fetch(req)));
});
