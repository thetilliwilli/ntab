/* sync scenario: the real server (server/ntab-server.mjs, HTTPS with a certificate made like README says) and three
   "devices": the test page on three origins (localhost, 127.0.0.1, c.localhost), each with its own IndexedDB.
   its own headless Chrome trusts the certificate (--ignore-certificate-errors-spki-list); needs test/run.sh's server.
   run: node test/sync.mjs */
import { connect, sleep, ok, inDb, dbAll, resetData, DEVICE } from "./cdp.mjs";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ntab-sync-"));
const TOKEN = "test-token-0123456789";
const PORT = 8447;
const SERVER = `https://${TOKEN}@127.0.0.1:${PORT}`;

/* ---------- the server ---------- */

execSync(`openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=ntab" -addext "subjectAltName=IP:127.0.0.1" -keyout key.pem -out cert.pem`, { cwd: tmp, stdio: "ignore" });
const spki = execSync(`openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`, { cwd: tmp }).toString().trim();
let server = null;
async function startServer() {
  server = spawn("node", [path.join(ROOT, "server/ntab-server.mjs"), "--token", TOKEN, "--cert", "cert.pem", "--key", "key.pem", "--data", "data", "--listen", `127.0.0.1:${PORT}`], { cwd: tmp });
  await new Promise((r) => server.stdout.once("data", r));
}
async function stopServer() {
  server.kill();
  await new Promise((r) => server.once("exit", r));
}
await startServer();
/* what the server has: { "<store>/<id>": record } of live records */
async function serverData() {
  const out = execSync(`curl -s --cacert cert.pem -u ${TOKEN}: "https://127.0.0.1:${PORT}/pull?since=0"`, { cwd: tmp }).toString();
  const res = JSON.parse(out);
  return { head: res.head, records: Object.fromEntries(res.records.filter((r) => !r.deleted).map((r) => [`${r.store}/${r.id}`, r.data])) };
}

/* ---------- the browser ---------- */

const CDP = "http://127.0.0.1:9335";
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${tmp}/profile`, `--ignore-certificate-errors-spki-list=${spki}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 50; i++) {
  if (await fetch(`${CDP}/json/version`).then(() => true, () => false)) break;
  await sleep(200);
}
async function page(origin) {
  const t = await (await fetch(`${CDP}/json/new?${origin}/test.html`, { method: "PUT" })).json();
  const P = await connect(t.webSocketDebuggerUrl);
  await sleep(1200);
  return P;
}
const until = async (P, expr, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await P.ev(expr).catch(() => false)) return true;
  return false;
};
const status = (P) => P.ev(`document.getElementById('sync-status').textContent`);
async function connectTo(P, url) {
  await P.ev(`document.getElementById('sync-url').value = ${JSON.stringify(url)}; document.getElementById('sync-form').requestSubmit()`);
  await sleep(800);
}
const reload = async (P) => {
  await P.send("Page.reload");
  await sleep(1200);
};
const model = (app) => `(await import('/apps/${app}/model.js'))`;
const run = (P, code) => P.ev(`(async () => ${code})()`);

const A = await page("http://localhost:8765");
const B = await page("http://127.0.0.1:8765");

// A: used before any server (offline): notes, a task, a tracker type and entry, a setting, a deleted task
await A.ev(resetData());
await A.ev(inDb(`async (s) => {
  s.notes.put({ id: "n1", name: "todo", text: "milk", createdAt: 1, updatedAt: 1 });
  s.tasks.put({ id: "t1", name: "Task one", description: "", status: "new", rank: 1, createdAt: 1, updatedAt: 1 });
  s.tasks.put({ id: "t2", name: "Task two", description: "", status: "new", rank: 2, createdAt: 1, updatedAt: 1 });
  s.trackerTypes.put({ id: "y1", name: "walk", icon: "🚶", kind: "activity", rank: 1, archivedAt: null, createdAt: 1, updatedAt: 1 });
  s.trackerEntries.put({ id: "e1", typeId: "y1", at: 1000, endAt: 2000, updatedAt: 2000 });
}`));
await reload(A);
await run(A, `${model("board")}.remove("t2")`);
await A.ev(`document.getElementById('theme-btn').click()`); // auto -> light
await sleep(600);
ok("no server: nothing waits in the outbox", (await A.ev(dbAll("outbox"))).length === 0);
ok("no server: status says so", (await status(A)).startsWith("Not set"), await status(A));

// wrong token, wrong address
await connectTo(A, `https://wrong-token-000000@127.0.0.1:${PORT}`);
ok("a wrong token is refused", (await A.ev(`document.getElementById('data-msg').textContent`)).includes("refused the token"), await A.ev(`document.getElementById('data-msg').textContent`));
await connectTo(A, `http://${TOKEN}@127.0.0.1:${PORT}`);
ok("http is refused", (await A.ev(`document.getElementById('data-msg').textContent`)).includes("https://"));

// A connects: everything it has goes to the (empty) server
await connectTo(A, SERVER);
ok("A online", await until(A, `document.getElementById('sync-status').textContent.startsWith('Synced with 127.0.0.1:${PORT}')`), await status(A));
let srv = await serverData();
ok("server got A's data", ["notes/n1", "tasks/t1", "trackerTypes/y1", "trackerEntries/e1", "actions/a0", "settings/2f389033-4033-4a9f-b7d4-4e62d13dc1ba"].every((k) => k in srv.records) && !("tasks/t2" in srv.records), Object.keys(srv.records).join());
ok("sidebar shows the state", (await A.ev(`document.getElementById('data-btn').dataset.sync`)) === "online");

// B: a fresh device (only the default actions): connects without a question, gets A's data, its defaults go
await B.ev(`document.getElementById('data-btn').click()`);
await connectTo(B, SERVER);
ok("B: no Merge/Replace question", await B.ev(`document.getElementById('sync-choice').hidden`));
ok("B online", await until(B, `document.getElementById('sync-status').textContent.startsWith('Synced')`), await status(B));
await sleep(500);
const names = async (P, store) => (await P.ev(dbAll(store))).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((r) => r.name).join();
ok("B has A's actions (its defaults gone)", (await names(B, "actions")) === (await names(A, "actions")), await names(B, "actions"));
ok("B has A's notes, tasks, tracker", (await names(B, "notes")) === "todo" && (await names(B, "tasks")) === "Task one" && (await B.ev(dbAll("trackerEntries"))).length === 1);
ok("B took A's theme", await until(B, `document.documentElement.dataset.theme === 'light'`));

// real time: an activity started on A, finished on B
await run(A, `${model("tracker")}.start()`);
const started = await run(A, `${model("tracker")}.log("y1").then((e) => e.id)`);
ok("B sees the running activity", await until(B, inDb(`async (s, req) => (await req(s.trackerEntries.get(${JSON.stringify(started)})))?.endAt === null`, "readonly"), 4000));
await run(B, `${model("tracker")}.start()`);
await run(B, `${model("tracker")}.finish(${JSON.stringify(started)})`);
ok("A sees it finished", await until(A, inDb(`async (s, req) => (await req(s.trackerEntries.get(${JSON.stringify(started)})))?.endAt > 0`, "readonly"), 4000));

// notes: typed on A, shown in B's open tab
for (const P of [A, B]) {
  await P.ev(`document.getElementById('data').close()`);
  await P.ev(`document.querySelector('#links .notes').click()`);
  await sleep(500);
  await run(P, `(await import('/apps/notes/notes.js')).open("n1")`);
  await sleep(200);
}
await A.ev(`(() => { const t = document.getElementById('text'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()`);
await A.type(" and bread");
ok("B's open note follows A's typing", await until(B, `document.getElementById('text').value === 'milk and bread'`, 5000), await B.ev(`document.getElementById('text').value`));

// a delete and a move travel; a move changes one record
await run(A, `${model("board")}.start()`);
await run(A, `${model("board")}.add({ name: "Task three" })`);
ok("B gets the new task", await until(B, `(${dbAll("tasks")}).then((l) => l.length === 2)`));
const head = (await serverData()).head;
await run(B, `${model("board")}.start()`);
await run(B, `${model("board")}.move("t1", "work")`);
ok("A: the moved task", await until(A, inDb(`async (s, req) => (await req(s.tasks.get("t1"))).status === "work"`, "readonly")));
ok("a move = one change on the server", (await serverData()).head === head + 1);
await run(A, `${model("board")}.remove("t1")`);
ok("B: the deleted task is gone", await until(B, `(${dbAll("tasks")}).then((l) => !l.some((t) => t.id === "t1"))`));

// offline: the server stops; both edit the same task, B later; a new task on A waits; back: all of it arrives
const t3 = (await A.ev(dbAll("tasks")))[0].id;
await stopServer();
await run(A, `${model("board")}.update(${JSON.stringify(t3)}, { name: "A's name" })`);
await sleep(50);
await run(B, `${model("board")}.update(${JSON.stringify(t3)}, { name: "B's name" })`);
await run(A, `${model("board")}.add({ name: "Made offline" })`);
await A.ev(`document.getElementById('data-btn').click()`);
ok("A offline, its changes wait", await until(A, `/Offline: .*2 changes wait here/.test(document.getElementById('sync-status').textContent)`), await status(A));
ok("sidebar: offline", (await A.ev(`document.getElementById('data-btn').dataset.sync`)) === "offline");
await startServer();
const taskNames = (P) => P.ev(`(${dbAll("tasks")}).then((l) => l.map((t) => t.name).sort().join())`);
ok("back online: both agree, the later edit won", await until(B, `(${dbAll("tasks")}).then((l) => l.map((t) => t.name).sort().join() === "B's name,Made offline")`, 40000), await taskNames(B));
ok("A agrees", await until(A, `(${dbAll("tasks")}).then((l) => l.map((t) => t.name).sort().join() === "B's name,Made offline")`, 5000), await taskNames(A));

// Disconnect: changes wait; Connect again: they go
await A.ev(`document.getElementById('sync-disconnect').click()`);
await sleep(300);
await run(A, `${model("board")}.add({ name: "While paused" })`);
ok("paused, the change waits", await until(A, `/Paused .*1 change waits/.test(document.getElementById('sync-status').textContent)`), await status(A));
await connectTo(A, SERVER);
ok("B gets what was made while paused", await until(B, `(${dbAll("tasks")}).then((l) => l.some((t) => t.name === "While paused"))`));

// C: a device with data of its own: Merge / Replace this device
const C = await page("http://c.localhost:8765");
await C.ev(inDb(`async (s) => s.tasks.put({ id: "c1", name: "Only on C", description: "", status: "new", rank: 1, createdAt: 1, updatedAt: 5 })`));
await reload(C);
await C.ev(`document.getElementById('data-btn').click()`);
await connectTo(C, SERVER);
ok("C is asked: Merge or Replace", await C.ev(`!document.getElementById('sync-choice').hidden`));
await C.ev(`document.getElementById('sync-replace').click()`);
ok("Replace: C has the server's tasks only", await until(C, `(${dbAll("tasks")}).then((l) => l.map((t) => t.name).sort().join() === "B's name,Made offline,While paused")`), await taskNames(C));
ok("C's task didn't reach the server", !Object.values((await serverData()).records).some((r) => r.name === "Only on C"));

// D: data of its own, Merge: both sets on both sides
const D = await page("http://d.localhost:8765");
await D.ev(inDb(`async (s) => s.tasks.put({ id: "d1", name: "Only on D", description: "", status: "new", rank: 1, createdAt: 1, updatedAt: 5 })`));
await reload(D);
await D.ev(`document.getElementById('data-btn').click()`);
await connectTo(D, SERVER);
await D.ev(`document.getElementById('sync-merge').click()`);
ok("Merge: D has both", await until(D, `(${dbAll("tasks")}).then((l) => l.map((t) => t.name).sort().join() === "B's name,Made offline,Only on D,While paused")`), await taskNames(D));
ok("Merge: the others get D's task", await until(B, `(${dbAll("tasks")}).then((l) => l.some((t) => t.name === "Only on D"))`));
ok("Merge: D's default actions gave way", (await names(D, "actions")) === (await names(A, "actions")), await names(D, "actions"));
D.close();

// a device on another origin of the server list (--origin) would be refused: covered by the server's own checks
ok("the token is not in the page's requests' URL", !(await A.ev(`performance.getEntriesByType('resource').some((e) => e.name.includes(${JSON.stringify(TOKEN)}))`)));

console.log("errors:", A.errors, B.errors, C.errors);
for (const P of [A, B, C]) P.close();
chrome.kill();
await stopServer();
process.exit(0);
