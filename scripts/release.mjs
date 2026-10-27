/*
 * builds everything for a Chrome Web Store release into ignore/publish/: package, texts, screenshots, promo tiles
 * and README.md with the steps. sources: manifest.json (name, summary, version, permissions) and store/.
 *
 *   npm run release           checks + build (needs a clean tree and a version above store/published.json)
 *   npm run release -- --draft  same without the checks, to preview screenshots and texts
 *   npm run release:done      after the store accepted it: records the version in store/published.json and commits
 *
 * screenshots are taken in headless Chrome (CHROME=… to override the binary) on the test page (test/stub.js),
 * filled with store/demo.mjs. site icons are fetched once from Google's favicon service; without network the
 * tiles show letters.
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { connect, sleep } from "../test/cdp.mjs";
import * as demo from "../store/demo.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "ignore/publish");
let cdpPort = 0; // headless Chrome, set by launchChrome()
const LIMITS = { name: 75, summary: 132, description: 16000, privacy: 1000 };

const rel = (...p) => path.join(ROOT, ...p);
const read = (p) => fs.readFileSync(rel(p), "utf8");
const readJson = (p) => JSON.parse(read(p));
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const cmpVer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

const manifest = readJson("manifest.json");
const published = readJson("store/published.json");
const perms = manifest.permissions || [];

if (process.argv.includes("done")) {
  const record = { version: manifest.version, permissions: perms, commit: git("rev-parse", "--short", "HEAD") };
  fs.writeFileSync(rel("store/published.json"), JSON.stringify(record, null, 2) + "\n");
  git("commit", "-m", `Published ${manifest.version} to the Chrome Web Store`, "--", "store/published.json");
  console.log(`store/published.json: ${manifest.version} @ ${record.commit}, committed`);
  process.exit(0);
}

const draft = process.argv.includes("--draft");

/* ---------- checks ---------- */

const problems = [];
const notes = []; // things to point out in the README
const privacy = Object.fromEntries(
  ["single-purpose", ...perms].map((k) => [k, fs.existsSync(rel(`store/privacy/${k}.txt`)) ? read(`store/privacy/${k}.txt`).trim() : null]),
);
const description = read("store/description.txt").trim();

if (git("status", "--porcelain")) problems.push("Uncommitted changes: commit first, the package is built from HEAD.");
if (cmpVer(manifest.version, published.version) <= 0)
  problems.push(`Version ${manifest.version} is not above the published ${published.version}: raise "version" in manifest.json.`);
for (const [k, v] of Object.entries(privacy)) if (!v) problems.push(`Missing store/privacy/${k}.txt.`);
for (const [k, v, max] of [
  ["name", manifest.name, LIMITS.name],
  ["summary (manifest description)", manifest.description, LIMITS.summary],
  ["store/description.txt", description, LIMITS.description],
  ...Object.entries(privacy).map(([k, v]) => [`store/privacy/${k}.txt`, v || "", LIMITS.privacy]),
])
  if (v.length > max) problems.push(`${k} is ${v.length} characters, the store allows ${max}.`);

const added = perms.filter((p) => !published.permissions.includes(p));
const removed = published.permissions.filter((p) => !perms.includes(p));
if (added.length)
  notes.push(`NEW PERMISSIONS: ${added.join(", ")}. Add their justification on the Privacy tab. If Chrome shows a warning ` +
    `for them, existing users get the extension disabled until they accept.`);
if (removed.length) notes.push(`Removed permissions: ${removed.join(", ")}. Their justification fields disappear by themselves.`);
if (manifest.host_permissions?.length || manifest.content_scripts?.length)
  notes.push("The manifest has host permissions or content scripts: expect a longer review.");

if (problems.length) {
  console.log(problems.map((p) => "✗ " + p).join("\n"));
  if (!draft) process.exit(1);
  console.log("--draft: building anyway\n");
}

/* ---------- texts, package, icon ---------- */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "privacy"), { recursive: true });
fs.mkdirSync(path.join(OUT, "screenshots"));
const out = (p, data) => fs.writeFileSync(path.join(OUT, p), data);

const zip = `ntab-${manifest.version}.zip`;
git("archive", "-o", path.join(OUT, zip), "HEAD", "manifest.json", "newtab.html", "newtab.css", "js", "icons");
out("name.txt", manifest.name);
out("summary.txt", manifest.description);
out("description.txt", description);
for (const [k, v] of Object.entries(privacy)) if (v) out(`privacy/${k}.txt`, v);
fs.copyFileSync(rel("icons/icon-128.png"), path.join(OUT, "icon-128.png"));
const since = published.commit ? git("log", "--format=- %s", `${published.commit}..HEAD`) : "";
out("changes.txt", since + "\n");
console.log("✓ package and texts");

/* ---------- images ---------- */

const listing = readJson("store/listing.json");
const server = await serve();
const browser = await launchChrome();
try {
  const icons = await fetchIcons();
  await screenshots(icons);
  await promoTiles();
} finally {
  await browser.kill();
  server.close();
}

out("README.md", readme());
console.log(`\n${problems.length ? "DRAFT — fix the problems above before publishing.\n" : ""}Done: ${path.relative(process.cwd(), OUT)}/README.md`);

/* ---------- screenshots ---------- */

async function screenshots(icons) {
  let P = await openPage("/test.html");

  const shot = async (n, what) => {
    await sleep(400);
    await P.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1020, y: 636 }); // nothing hovered by accident
    if (what.hover) await hover(P, what.hover);
    await sleep(300);
    out(`screenshots/${n}.png`, await capture(P));
    console.log(`✓ screenshot ${n}: ${what.label}`);
  };

  // first visit: grant the folder (the stub's picker), later loads restore the open tabs from the session
  P = await prepare(P, icons, { theme: "light", active: "todo.md" });
  await openNotepad(P);

  // 1. notepad with tabs
  P = await prepare(P, icons, { theme: "light", active: "todo.md" });
  await openNotepad(P);
  await caret(P, "Prepare slides for Thursday's demo");
  await shot(1, { label: "notepad" });

  // 2. home screen
  P = await prepare(P, icons, { theme: "light", active: "todo.md" });
  await shot(2, { label: "home screen" });

  // 3. dark theme, wrapped text, sidebar flyout
  P = await prepare(P, icons, { theme: "dark", active: "meeting-notes.txt", wrap: true });
  await openNotepad(P);
  await caret(P, "decision by next Tuesday");
  await shot(3, { label: "dark theme + flyout", hover: "#links .link:nth-child(5)" });

  // 4. file list
  P = await prepare(P, icons, { theme: "light", active: "todo.md" });
  await openNotepad(P);
  await P.ev(`document.getElementById('tab-add').click()`);
  await shot(4, { label: "file list" });

  // 5. actions editor
  P = await prepare(P, icons, { theme: "dark", active: "todo.md" });
  await P.ev(`document.getElementById('links-edit').click()`);
  await shot(5, { label: "actions editor" });
  await closePage(P);
}

/* fills storage + the notes folder, then swaps the page for a new tab that starts from them
   (a new tab, not a reload: a page with the notepad open saves its session into sessionStorage on the way out) */
async function prepare(P, icons, { theme, active, wrap = false }) {
  const sync = { "links.n": demo.actions.length, settings: { fontSize: 14, wrap, tabSize: 2, theme } };
  demo.actions.forEach((a, i) => (sync[`links.${i}`] = a));
  const local = { icons, session: { tabs: demo.openTabs, active, views: {} } };
  await P.ev(`(async () => {
    chrome.storage.local.set = chrome.storage.sync.set = async () => {}; // this page's pending session writes must not land
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("stub:sync", ${JSON.stringify(JSON.stringify(sync))});
    localStorage.setItem("stub:local", ${JSON.stringify(JSON.stringify(local))});
    localStorage.setItem("theme", ${JSON.stringify(theme)});
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("notes", { create: true });
    for await (const name of dir.keys()) await dir.removeEntry(name);
    for (const [name, text] of Object.entries(${JSON.stringify(demo.notes)})) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  })()`);
  await closePage(P);
  P = await openPage("/test.html");
  await P.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 640, deviceScaleFactor: 1.25, mobile: false });
  await P.send("Page.reload");
  await sleep(900);
  return P;
}

async function openNotepad(P) {
  await P.ev(`document.querySelector('#links .notes').click()`);
  await sleep(500);
  if (await P.ev(`!document.getElementById('gate').hidden`)) {
    await P.ev(`document.getElementById('gate-btn').click()`); // the stub's picker hands out the OPFS folder
    await sleep(700);
  }
}

/* puts the cursor at the end of the line containing `text` */
async function caret(P, text) {
  await P.ev(`(() => {
    const t = document.getElementById('text');
    const i = t.value.indexOf(${JSON.stringify(text)}) + ${text.length};
    t.focus();
    t.setSelectionRange(i, i);
    t.dispatchEvent(new Event('select'));
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
}

async function hover(P, selector) {
  const r = await P.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await P.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] });
}

/* site icons as uploaded-icon data URLs keyed by hostname (what the extension stores for uploads) */
async function fetchIcons() {
  const icons = {};
  for (const a of demo.actions.filter((a) => a.url)) {
    // one at a time: parallel requests to this service tend to stall
    const host = new URL(a.url).hostname;
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${host}&sz=128`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) icons[host] = `data:${res.headers.get("content-type") || "image/png"};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {}
  }
  if (!Object.keys(icons).length) notes.push("Site icons could not be fetched (offline?): the screenshots show letters. Run again with network.");
  return icons;
}

/* ---------- promo tiles ---------- */

async function promoTiles() {
  for (const [file, w, h] of [["promo-small-440x280.png", 440, 280], ["promo-marquee-1400x560.png", 1400, 560]]) {
    const P = await openPage(`/promo.html?${w}x${h}`) // one query param: a "&" would end up in /json/new's own query;
    await P.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    out(file, await capture(P));
    await closePage(P);
    console.log(`✓ ${file}`);
  }
}

function promoHtml(w, h) {
  const big = w > 1000;
  const icon = read("icons/icon.svg").replace("<svg ", `<svg width="${big ? 120 : 96}" height="${big ? 120 : 96}" `);
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { width: ${w}px; height: ${h}px; overflow: hidden; display: flex; align-items: center; gap: 48px;
      padding: 0 ${big ? 72 : 36}px; background: #ececee; font-family: system-ui, sans-serif; color: #1d1d1f; }
    .text { display: flex; flex-direction: column; gap: ${big ? 18 : 10}px; flex: none; }
    .head { display: flex; align-items: center; gap: ${big ? 28 : 20}px; }
    h1 { font-size: ${big ? 96 : 64}px; line-height: 1; font-weight: 700; letter-spacing: -1px; }
    h2 { font-size: ${big ? 30 : 20}px; font-weight: 500; color: #1f6feb; }
    p { font-size: ${big ? 24 : 16}px; color: #6e6e75; max-width: ${big ? 480 : 360}px; line-height: 1.35; }
    img { height: ${h - 96}px; border: 1px solid #a5a5ad; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
  </style>
  <div class="text">
    <div class="head">${icon}<h1>NTab</h1></div>
    <h2>Notepad New Tab</h2>
    <p>Plain-text notes and your favorite sites in every new tab.</p>
  </div>
  ${big ? `<img src="/out/screenshots/1.png" alt="">` : ""}`;
}

/* ---------- README ---------- */

function readme() {
  const f = (p) => `\`${p}\``;
  const shots = fs.readdirSync(path.join(OUT, "screenshots")).map((s) => `screenshots/${s}`);
  return `# Publish ${manifest.name} ${manifest.version}

${problems.length ? `**DRAFT, not ready:**\n${problems.map((p) => `- ${p}`).join("\n")}\n\n` : ""}${notes.length ? `**Attention:**\n${notes.map((p) => `- ${p}`).join("\n")}\n\n` : ""}Published now: ${published.version}. Dashboard: https://chrome.google.com/webstore/devconsole → the extension.
Every text below is a file in this folder: open it, Ctrl+A, Ctrl+C, paste.

## 1. Package

**Package** → **Upload new package** → ${f(zip)}.
The title, summary, version and permissions are read from it (${f("name.txt")}, ${f("summary.txt")} are copies, nothing to paste).

## 2. Store listing

- **Description** ← ${f("description.txt")} (replace all). Check the "WHAT'S NEW" part against ${f("changes.txt")} (commits since the last release).
- **Category**: ${listing.category}. **Language**: ${listing.language}.
- **Store icon** ← ${f("icon-128.png")} (only if the icon changed).
- **Screenshots**: delete the old ones, then upload in this order:
${shots.map((s) => `  - ${f(s)}`).join("\n")}
- **Small promo tile** ← ${f("promo-small-440x280.png")}
- **Marquee promo tile** ← ${f("promo-marquee-1400x560.png")} (optional, used only if Google features the extension)
- **Homepage URL** ← ${listing.homepage}
- **Support URL** ← ${listing.support}
- **Save draft.**

## 3. Privacy

- **Single purpose** ← ${f("privacy/single-purpose.txt")}
${perms.map((p) => `- **${p} justification** ← ${f(`privacy/${p}.txt`)}${added.includes(p) ? " — NEW" : ""}`).join("\n")}
- Remote code: **No**. Data usage: tick nothing, tick the three certifications.
- **Save draft.**

## 4. Submit

**Submit for review**. Review takes from a few hours to a few days; the result comes by email.

## 5. After it is published

\`\`\`sh
npm run release:done
\`\`\`

records ${manifest.version} as published in ${f("store/published.json")} and commits it.
`;
}

/* ---------- headless Chrome + local server ---------- */

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let body, file;
    if (url.pathname === "/test.html")
      body = read("newtab.html").replace('<script type="module" src="js/main.js">', '<script src="stub.js"></script>\n$&');
    else if (url.pathname === "/promo.html") body = promoHtml(...url.search.slice(1).split("x").map(Number));
    else if (url.pathname === "/stub.js") file = rel("test/stub.js");
    else if (url.pathname.startsWith("/out/")) file = path.join(OUT, url.pathname.slice(5));
    else if (/^\/(js|icons)\/[\w.-]+$|^\/newtab\.css$/.test(url.pathname)) file = rel(url.pathname.slice(1));
    if (file && fs.existsSync(file)) body = fs.readFileSync(file);
    if (body == null) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(file || url.pathname)] || "text/html" }).end(body);
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ntab-release-"));
  const proc = spawn(process.env.CHROME || "google-chrome",
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
    { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error("headless Chrome did not start (set CHROME=/path/to/chrome)");
  await sleep(100);
  cdpPort = +fs.readFileSync(portFile, "utf8").split("\n")[0];
  return {
    async kill() {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await exited;
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function openPage(p) {
  const url = `http://127.0.0.1:${server.address().port}${p}`;
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${url}`, { method: "PUT" })).json();
  const P = await connect(target.webSocketDebuggerUrl);
  P.id = target.id;
  await sleep(600);
  return P;
}

async function closePage(P) {
  P.close();
  await fetch(`http://127.0.0.1:${cdpPort}/json/close/${P.id}`);
}

/* the store wants PNGs without alpha */
async function capture(P) {
  const png = Buffer.from((await P.send("Page.captureScreenshot", { format: "png" })).result.data, "base64");
  return dropAlpha(png);
}

/* ---------- PNG: RGBA -> RGB (8-bit, non-interlaced, what Chrome writes) ---------- */

function dropAlpha(png) {
  const chunks = [];
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    chunks.push({ type: png.toString("latin1", i + 4, i + 8), data: png.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  const ihdr = chunks[0].data;
  const [w, h, depth, color] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]];
  if (color === 2) return png;
  if (color !== 6 || depth !== 8 || ihdr[12]) throw new Error(`unexpected PNG format (color ${color}, depth ${depth})`);

  const src = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = w * 4;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const dst = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const f = src[y * (stride + 1)];
    const row = src.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let p = row[x];
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = p & 255;
    }
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) line.copy(dst, o + 1 + x * 3, x * 4, x * 4 + 3);
    line.copy(prev);
  }
  const head = Buffer.from(ihdr);
  head[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(dst, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, "latin1");
  data.copy(b, 8);
  b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
