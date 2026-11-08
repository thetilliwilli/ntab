/* the real extension, not the test page: Chrome over a DevTools pipe loads this folder unpacked
   (Extensions.loadUnpacked) and opens its newtab.html. catches what the localhost harness can't: the MV3 CSP, the
   sandboxed render frame, the load order of extension pages, what a site opened from a tile learns about us
   (no opener, no referrer), the sync with a server that allows only the extension's origin. no network needed.
   run: node test/extension.mjs (starts its own headless Chrome; the harness from run.sh is not needed) */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { ok, sleep } from "./cdp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ntab-ext-"));
// a certificate for the sync server, made like README says; this Chrome trusts it
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=ntab" -addext "subjectAltName=IP:127.0.0.1" -keyout key.pem -out cert.pem`, { cwd: profile, stdio: "ignore" });
const spki = execSync(`openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`, { cwd: profile }).toString().trim();
const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}/chrome`, `--ignore-certificate-errors-spki-list=${spki}`, "--no-first-run", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);
let server = null;
const quit = (code) => {
  server?.kill();
  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};

/* the pipe protocol: JSON messages ended by \0 */
let id = 0;
let buf = "";
const pending = new Map();
const errors = [];
chrome.stdio[4].on("data", (d) => {
  buf += d;
  for (let i; (i = buf.indexOf("\0")) >= 0; buf = buf.slice(i + 1)) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.id && pending.has(m.id)) pending.get(m.id)(m);
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description);
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((r) => {
    pending.set(++id, r);
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });

const loaded = await send("Extensions.loadUnpacked", { path: root });
if (loaded.error) {
  console.log("FAIL load the extension", JSON.stringify(loaded.error));
  quit(1);
}
const ext = loaded.result.id;
ok("extension loads", !!ext);

let evSession = null; // the session of the last page opened
async function open(page) {
  const { targetId } = (await send("Target.createTarget", { url: `chrome-extension://${ext}/${page}` })).result;
  const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })).result;
  evSession = sessionId;
  await send("Runtime.enable", {}, sessionId);
  return async (expression) => {
    const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)).result;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
}

const ev = await open("newtab.html");
await sleep(1500);
ok("home with the default tiles", (await ev(`document.querySelectorAll('#home-grid .tile').length`)) >= 5);

/* the sync server: the MV3 page may talk to it (CSP), and --origin lets the extension's origin in, and only it */
const TOKEN = "extension-test-token-1234";
const startServer = async (origin) => {
  server?.kill();
  server = spawn("node", [path.join(root, "server/ntab-server.mjs"), "--token", TOKEN, "--cert", "cert.pem", "--key", "key.pem", "--data", "srv", "--listen", "127.0.0.1:8448", "--origin", origin], { cwd: profile });
  await new Promise((r) => server.stdout.once("data", r));
};
const connectSync = () =>
  ev(`(async () => {
    document.getElementById("sync-url").value = "https://${TOKEN}@127.0.0.1:8448";
    document.getElementById("sync-form").requestSubmit();
    for (let i = 0; i < 40 && !/^(Synced|Offline)/.test(document.getElementById("sync-status").textContent) && !/refused|reach/.test(document.getElementById("data-msg").textContent); i++)
      await new Promise((r) => setTimeout(r, 150));
    return document.getElementById("sync-status").textContent + " | " + document.getElementById("data-msg").textContent;
  })()`);
await startServer("https://elsewhere.example");
let s = await connectSync();
ok("sync: a server for other origins refuses the extension (the browser hides why: CORS)", s.includes("can't reach") && s.includes("--origin") && !s.startsWith("Synced"), s);
await startServer(`chrome-extension://${ext}`);
s = await connectSync();
ok("sync: the extension connects to a server that allows its origin", s.startsWith("Synced with 127.0.0.1:8448"), s);
const head = JSON.parse(execSync(`curl -s --cacert cert.pem -u ${TOKEN}: "https://127.0.0.1:8448/pull?since=0"`, { cwd: profile })).records.length;
ok("sync: the server got the extension's data", head >= 5, String(head));
await ev(`document.getElementById("data").close()`);

/* a request through the render frame: the frame loads before the page listens, the handshake must still work */
const run = (url, render) =>
  ev(`(async () => {
    const { runRequest } = await import("./shell/request.js");
    runRequest({ id: "t", name: "T", kind: "request", options: { url: ${JSON.stringify(url)}, method: "GET", headers: {}, body: "", render: ${JSON.stringify(render)} } });
    for (let i = 0; i < 50 && !document.getElementById("req-status").textContent.startsWith("200"); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 700));
    return { status: document.getElementById("req-status").textContent, note: document.getElementById("req-note").textContent,
      height: parseFloat(document.getElementById("req-frame").style.height), rendered: !document.getElementById("req-copy").hidden,
      copy: await import("./shell/request.js").then((m) => m.renderedText?.()) };
  })()`);

let r = await run(`chrome-extension://${ext}/manifest.json`, "w => w.json.short_name");
ok("render frame answers (text)", r.status.startsWith("200") && r.rendered, JSON.stringify(r));
const page = `<html><head><meta name="x"><link rel="stylesheet" href="a.css"></head><body>${"<div class=row><a href='/x'>match</a> <img src='p.png'></div>".repeat(500)}</body></html>`;
const url = `data:text/html;base64,${Buffer.from(page).toString("base64")}`;
r = await run(url, "w => w");
ok("a whole HTML page (the window itself: its text)", r.rendered && r.height > 1000, r.copy.slice(0, 40));
r = await run(url, "w => w.document.links.length + ' links, ' + w.document.body.innerText.slice(0, 5)");
ok("the response as a document in the sandbox", r.rendered && r.copy === "500 links, match", JSON.stringify(r));
r = await run(url, "w => w.document.querySelector('.row').outerHTML");
ok("an element picked from it, rendered", r.rendered && r.copy.trim() === "match", JSON.stringify(r));

/* a site opened from a tile (in a new tab and in this one) gets no opener and no referrer: nothing of the extension */
const seen = [];
const site = http.createServer((req, res) => {
  if (req.url.startsWith("/report")) {
    const r = JSON.parse(decodeURIComponent(req.url.split("?")[1]));
    seen.push({ ...r, header: seenHeader[r.tab] });
    return res.end();
  }
  seenHeader[new URL(req.url, "http://x").searchParams.get("tab")] = req.headers.referer ?? null;
  res.writeHead(200, { "content-type": "text/html" }).end(`<script>
    fetch("/report?" + encodeURIComponent(JSON.stringify({ tab: new URLSearchParams(location.search).get("tab"),
      referrer: document.referrer, opener: window.opener !== null })));
  </script>`);
});
const seenHeader = {};
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const land = `http://127.0.0.1:${site.address().port}/land`;
await ev(`import("./shared/db.js").then((db) => db.replace("actions", [
  { id: "a0", name: "New", icon: null, rank: 0, kind: "open", options: { url: "${land}?tab=new", newTab: true } },
  { id: "a1", name: "Same", icon: null, rank: 1, kind: "open", options: { url: "${land}?tab=same", newTab: false } },
]))`);
await ev(`document.getElementById("req").close()`);
await sleep(500);
const clickTile = async (name) => {
  const { x, y } = await ev(`(() => { const r = [...document.querySelectorAll('#home-grid .tile')].find((t) => t.textContent.includes(${JSON.stringify(name)})).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, evSession);
};
await clickTile("New");
await sleep(1500);
await clickTile("Same");
await sleep(1500);
for (const tab of ["new", "same"]) {
  const s = seen.find((x) => x.tab === tab);
  ok(`site opened in ${tab === "new" ? "a new tab" : "the same tab"}: no opener, no referrer`, s && !s.opener && s.referrer === "" && s.header === null, JSON.stringify(s ?? seen));
}
site.close();

console.log("errors:", errors);
quit(0);
