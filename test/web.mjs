/* the web version (PWA, no chrome.*): serves the repo as it is (like GitHub Pages) on its own port, then checks
   index.html → newtab.html, the web platform, the manifest, the service worker and its cache, a request that CORS
   blocks (no "Allow access", the note points to the extension), that the app works offline after the server
   is gone, updates while the app runs (a bar in an app, a reload on home), and that a site opened from a tile gets no opener and no referrer; sw.js must be up to date (node scripts/sw.mjs). needs test/run.sh's Chrome (CDP on 9333).
   run: node test/web.mjs   (SHOTS=dir for a screenshot) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { connect, CDP, sleep, ok, inDb, dbAll } from "./cdp.mjs";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8767;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS;
let swVersion = null; // serve sw.js with this VERSION (a new release)

let stale = false;
try {
  execFileSync("node", [path.join(ROOT, "scripts/sw.mjs"), "--check"], { stdio: "pipe" });
} catch {
  stale = true;
}
ok("sw.js is up to date", !stale, stale ? "run node scripts/sw.mjs" : "");

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
function serve(req, res) {
  let p = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + "/") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  let body = fs.readFileSync(file);
  if (p === "/sw.js" && swVersion) body = body.toString().replace(/const VERSION = "\w+"/, `const VERSION = "${swVersion}"`);
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(body);
};
let server = http.createServer(serve);
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const target = await (await fetch(`${CDP}/json/new?${ORIGIN}/`, { method: "PUT" })).json();
const P = await connect(target.webSocketDebuggerUrl);
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(1000);

// a clean start: no service worker or caches from an earlier run
await P.ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
})()`);
await P.send("Page.navigate", { url: `${ORIGIN}/` });
await sleep(1500);

ok("index.html opens newtab.html", (await P.ev("location.pathname")) === "/newtab.html");
ok("web platform", (await P.ev(`import('./platform/index.js').then((p) => p.name + ' ' + p.canRequestAccess)`)) === "web false");
const man = await P.ev(`(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href;
  const m = await (await fetch(href)).json();
  const icons = await Promise.all(m.icons.map((i) => fetch(new URL(i.src, href)).then((r) => r.ok)));
  return { name: m.name, start: m.start_url, icons };
})()`);
ok("manifest linked, its icons exist", man.name === "NTab" && man.start === "newtab.html" && man.icons.length === 4 && man.icons.every(Boolean), JSON.stringify(man));

const reg = await P.ev(`navigator.serviceWorker.ready.then((r) => r.scope)`);
ok("service worker active", reg === `${ORIGIN}/`, reg);
await sleep(500);
const cache = await P.ev(`(async () => {
  const keys = (await caches.keys()).filter((k) => k.startsWith('ntab-'));
  return { keys, n: keys.length ? (await (await caches.open(keys[0])).keys()).length : 0 };
})()`);
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const version = sw.match(/const VERSION = "(\w+)"/)[1];
const files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
ok("every file cached under this version", cache.keys.length === 1 && cache.keys[0] === `ntab-${version}` && cache.n === files.length, JSON.stringify(cache));

// data: a request to a port where nothing listens fails like CORS does
await P.ev(inDb(`async (s) => {
  for (const store of Object.values(s)) store.clear();
  s.actions.put({ id: "a0", name: "Notes", icon: null, rank: 0, kind: "open", options: { url: "#/notes", newTab: false } });
  s.actions.put({ id: "a1", name: "Down", icon: null, rank: 1, kind: "request",
    options: { url: "http://localhost:8768/", method: "GET", headers: {}, body: "", render: null } });
  s.meta.put({ lastExportAt: null, remindAt: Date.now() + 864e6 }, "backup");
}`));
await P.send("Page.reload");
await sleep(1200);
ok("page is controlled by the service worker", await P.ev(`!!navigator.serviceWorker.controller`));
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
ok("version with the build", (await P.ev(`document.getElementById('app-ver').textContent`)) === `v${ver} · build ${version.slice(0, 8)}`, await P.ev(`document.getElementById('app-ver').textContent`));
ok("GitHub corner", (await P.ev(`(() => { const a = document.querySelector('.gh-corner'); return a.href + ' ' + a.target + ' ' + a.rel; })()`)) === "https://github.com/thetilliwilli/ntab _blank noopener noreferrer");
await sleep(300);
ok("a site's tile shows its letter (no favicon cache)", (await P.ev(`[...document.querySelectorAll('#home-grid .tile')].find((t) => t.textContent.includes('Down')).querySelector('.ico').outerHTML`)) === '<span class="ico">D</span>');
await P.ev(`[...document.querySelectorAll('#home-grid .tile')].find((t) => t.textContent.includes('Down')).click()`);
for (let t = 0; t < 10e3 && (await P.ev(`document.getElementById('req-status').textContent.endsWith('…')`)); t += 100) await sleep(100);
const r = await P.ev(`({ status: document.getElementById('req-status').textContent, allow: !document.getElementById('req-allow').hidden,
  note: document.getElementById('req-note').textContent })`);
ok("failed request: no Allow access, the note points to the extension", r.status === "request failed" && !r.allow && /work in the NTab extension\.$/.test(r.note), JSON.stringify(r));
await P.ev(`document.getElementById('req').close()`);

// offline: the server is gone, the app still starts and saves
await new Promise((r) => server.close(r));
server.closeAllConnections?.();
await P.send("Page.reload");
await sleep(1500);
ok("offline: home screen", await P.ev(`!document.getElementById('home').hidden && document.querySelectorAll('#home-grid .tile').length === 3`));
await P.ev(`document.querySelector('#links .notes').click()`);
await sleep(500);
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(400);
await P.type("offline");
await sleep(800);
const notes = await P.ev(dbAll("notes"));
ok("offline: a note is typed and saved", notes.length === 1 && notes[0].text === "offline", JSON.stringify(notes));
if (SHOTS) await P.shot(`${SHOTS}/web.png`);

// a new release while the app runs: coming back to the screen looks for it (an installed app is resumed, not
// reloaded); in an app a bar offers to reload, home reloads into it; on the home screen it reloads by itself
const waitCache = async (name) => {
  let keys;
  for (let t = 0; t < 10e3; t += 250) {
    await sleep(250);
    keys = await P.ev(`caches.keys().then((k) => k.filter((x) => x.startsWith('ntab-')))`).catch(() => null);
    if (keys?.length === 1 && keys[0] === name) break;
  }
  return keys;
};
const back = () => P.ev(`window.marker = 1; document.dispatchEvent(new Event('visibilitychange'))`);
const reloaded = () => P.ev(`window.marker === undefined`);
swVersion = "test1release";
server = http.createServer(serve);
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
await back();
let after = await waitCache("ntab-test1release");
await sleep(500);
ok("back on screen: the new version is fetched and replaces the cache", after?.length === 1 && after[0] === "ntab-test1release", JSON.stringify(after));
ok("in an app: no reload, the bar offers it", !(await reloaded()) && (await P.ev(`!document.getElementById('update-bar').hidden && !document.getElementById('app-notes').hidden`)));
await P.ev(`document.getElementById('go-home').click()`);
await sleep(1500);
ok("going home reloads into the new version", (await reloaded()) && (await P.ev(`document.getElementById('update-bar').hidden && !document.getElementById('home').hidden`)));
swVersion = "test2release";
await back();
after = await waitCache("ntab-test2release");
await sleep(1500);
ok("on the home screen: reloads by itself", after?.[0] === "ntab-test2release" && (await reloaded()) && (await P.ev(`document.getElementById('update-bar').hidden`)));
ok("the note survived the reloads", (await P.ev(dbAll("notes")))[0]?.text === "offline");

// a site opened from a tile (another origin; a new tab, then this one) gets no opener and no referrer
const seen = [];
const heads = {};
const site = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/report") {
    const r = JSON.parse(u.searchParams.get("r"));
    seen.push({ ...r, header: heads[r.tab] });
    return res.end();
  }
  heads[u.searchParams.get("tab")] = req.headers.referer ?? null;
  res.writeHead(200, { "content-type": "text/html" }).end(`<script>
    const tab = new URLSearchParams(location.search).get("tab");
    fetch("/report?r=" + encodeURIComponent(JSON.stringify({ tab, referrer: document.referrer, opener: window.opener !== null })));
  </script>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const land = `http://127.0.0.1:${site.address().port}/land`;
await P.ev(inDb(`async (s) => {
  s.actions.clear();
  s.actions.put({ id: "a0", name: "New", icon: null, rank: 0, kind: "open", options: { url: "${land}?tab=new", newTab: true } });
  s.actions.put({ id: "a1", name: "Same", icon: null, rank: 1, kind: "open", options: { url: "${land}?tab=same", newTab: false } });
}`));
await P.send("Page.reload");
await sleep(1200);
const clickTile = async (name) => {
  const { x, y } = await P.ev(`(() => { const r = [...document.querySelectorAll('#home-grid .tile')].find((t) => t.textContent.includes(${JSON.stringify(name)})).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await P.click(x, y);
};
await clickTile("New");
await sleep(1200);
await clickTile("Same");
await sleep(1200);
for (const tab of ["new", "same"]) {
  const r = seen.find((x) => x.tab === tab);
  ok(`site opened in ${tab === "new" ? "a new tab" : "the same tab"}: no opener, no referrer`, r && !r.opener && r.referrer === "" && r.header === null, JSON.stringify(r ?? seen));
}
for (const t of (await (await fetch(`${CDP}/json/list`)).json()).filter((t) => t.url.startsWith(land))) await fetch(`${CDP}/json/close/${t.id}`);
site.close();
site.closeAllConnections?.();
server.close();
server.closeAllConnections?.();

console.log("errors:", P.errors);
P.close();
await fetch(`${CDP}/json/close/${target.id}`).catch(() => {});
process.exit(0);
