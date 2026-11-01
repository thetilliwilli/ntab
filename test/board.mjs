/* board scenario: create, edit, move by status select and by dragging, delete, sync, records. run: node test/board.mjs (SHOTS=dir for screenshots) */
import { newPage, sleep, ok, resetData, dbAll, openApp } from "./cdp.mjs";

const SHOTS = process.env.SHOTS; // folder for screenshots, optional
const tasks = async (P) => (await P.ev(dbAll("tasks"))).sort((a, b) => a.rank - b.rank);
const col = (P, s) => P.ev(`[...document.querySelectorAll('.bd-${s} .bd-name')].map((n) => n.textContent)`);
const rect = (P, sel) => P.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: r.top, b: r.bottom, l: r.left }; })()`);

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "board");
ok("board open with 4 columns", await P.ev(`document.querySelectorAll('.bd-col').length === 4`));

const create = async (name, desc, status = "new") => {
  await P.ev(`document.getElementById('bd-new').click()`);
  await sleep(100);
  await P.ev(`document.getElementById('bd-name').value = ${JSON.stringify(name)}; document.getElementById('bd-desc').value = ${JSON.stringify(desc)}; document.getElementById('bd-status').value = ${JSON.stringify(status)}; document.getElementById('bd-task-form').requestSubmit()`);
  await sleep(300);
};
await create("Write report", "quarterly numbers");
await create("Call bank", "");
await create("Fix bug #12", "crash on start", "work");
ok("columns", JSON.stringify([await col(P, "new"), await col(P, "work")]) === '[["Write report","Call bank"],["Fix bug #12"]]');
let f = await tasks(P);
ok("3 task records with fields", f.length === 3 && f[0].id && f[0].createdAt && f[0].updatedAt && f[0].description === "quarterly numbers" && f[2].status === "work" && f.map((t) => t.rank).join() === "0,1,2");

// change status in the dialog
await P.ev(`document.querySelector('.bd-new .bd-card').click()`);
await sleep(150);
ok("dialog shows the task", await P.ev(`document.getElementById('bd-name').value === 'Write report'`));
await P.ev(`document.getElementById('bd-status').value = 'hold'; document.getElementById('bd-task-form').requestSubmit()`);
await sleep(300);
ok("moved to hold via the dialog", JSON.stringify(await col(P, "hold")) === '["Write report"]');

// drag "Call bank" (new) to the work column, before "Fix bug #12"
const from = await rect(P, ".bd-new .bd-card");
const to = await rect(P, ".bd-work .bd-card");
const mouse = (type, x, y) => P.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
await mouse("mousePressed", from.x, from.y);
await mouse("mouseMoved", from.x + 20, from.y + 10);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.t + 4 - from.y) * i) / 8);
if (SHOTS) await P.shot(`${SHOTS}/board-drag.png`);
await mouse("mouseReleased", to.x, to.t + 4);
await sleep(400);
ok("dragged into work, before the other card", JSON.stringify(await col(P, "work")) === '["Call bank","Fix bug #12"]', JSON.stringify(await col(P, "work")));
ok("dialog did not open after the drag", await P.ev(`!document.getElementById('bd-task').open`));
f = await tasks(P);
ok("ranks follow", f.map((t) => t.name).join() === "Call bank,Fix bug #12,Write report" && f[0].status === "work", JSON.stringify(f.map((t) => [t.name, t.rank])));

// drop at the end of an empty column
const a = await rect(P, ".bd-work .bd-card");
const done = await rect(P, ".bd-done .bd-list");
await mouse("mousePressed", a.x, a.y);
await mouse("mouseMoved", a.x + 20, a.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", a.x + ((done.x - a.x) * i) / 6, a.y + ((done.y - a.y) * i) / 6);
await mouse("mouseReleased", done.x, done.y);
await sleep(400);
ok("dropped into empty done", JSON.stringify(await col(P, "done")) === '["Call bank"]');

// second page: sees the board, a change there shows up here
const Q = await newPage();
await sleep(1200);
await openApp(Q, "board");
ok("page 2 loads the same board", JSON.stringify(await col(Q, "done")) === '["Call bank"]');
await Q.ev(`document.querySelector('.bd-work .bd-card').click()`);
await sleep(150);
await Q.ev(`window.confirm = () => true; document.getElementById('bd-del').click()`);
await sleep(500);
ok("deleted on page 2, gone on page 1 (sync)", (await col(P, "work")).length === 0 && (await tasks(P)).length === 2);

// concurrent creates keep both
await Promise.all(["A", "B"].map((n, i) => [P, Q][i].ev(`(async () => { document.getElementById('bd-new').click(); document.getElementById('bd-name').value = ${JSON.stringify(n)}; document.getElementById('bd-task-form').requestSubmit(); })()`)));
await sleep(800);
ok("concurrent creates: both saved", (await tasks(P)).length === 4, String((await tasks(P)).length));
if (SHOTS) await P.shot(`${SHOTS}/board.png`);
ok("title Board", (await P.ev(`document.title`)) === "Board");
console.log("errors:", P.errors, Q.errors);
P.close(); Q.close();
process.exit(0);
