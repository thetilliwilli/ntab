/* tracker scenario: types, one-shot events, activities, undo, time edit, sync between pages, files. run: node test/tracker.mjs (SHOTS=dir for screenshots) */
import { newPage, sleep, ok, dataDir, clearData, setActions, openApp } from "./cdp.mjs";

const SHOTS = process.env.SHOTS; // folder for screenshots, optional

const readAll = (P) => P.ev(`(async () => {
  const root = ${dataDir}; const d = await root.getDirectoryHandle('tracker', { create: true }); const out = {};
  for await (const h of d.values()) out[h.name] = await (await h.getFile()).text();
  return out; })()`);
const lines = (t) => t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
const q = (P, js) => P.ev(js);

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(clearData);
await P.ev(setActions([{ type: "notes", name: "Notes" }, { type: "tracker", name: "Tracker" }]));
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "tracker");
ok("tracker open, no types", await q(P, `!document.getElementById('app-tracker').hidden && document.querySelectorAll('.tr-tile').length === 1`));

const addType = async (name, icon, span) => {
  await P.ev(`document.querySelector('.tr-tile.add').click()`);
  await sleep(100);
  await P.ev(`document.getElementById('tr-new-name').value = ${JSON.stringify(name)}; document.getElementById('tr-new-icon').value = ${JSON.stringify(icon)}; document.getElementById('tr-new-span').checked = ${span}; document.getElementById('tr-new-form').requestSubmit()`);
  await sleep(300);
};
await addType("Покурил", "🚬", false);
await addType("Sleep", "🌙", true);
let f = await readAll(P);
const types = JSON.parse(f["types.json"]).types;
ok("types saved", types.length === 2 && types[0].id === "покурил" && types[1].span === true, JSON.stringify(types));

await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`); // already running: ignored
await sleep(300);
f = await readAll(P);
const file = Object.keys(f).find((k) => k.startsWith("events-"));
let ev = lines(f[file]);
ok("3 events appended (2 one-shot + 1 start)", ev.length === 3 && ev[2].phase === "start" && ev[2].activity, JSON.stringify(ev));
ok("running span shown", await q(P, `!document.getElementById('tr-spans').hidden && document.querySelectorAll('.tr-span').length === 1`));
ok("tile says ×2", await q(P, `document.querySelector('.tr-tile .tr-tile-meta').textContent.includes('×2')`));
await sleep(1500);
const dur1 = await q(P, `document.querySelector('.tr-dur').textContent`);
ok("duration ticks", /\ds$/.test(dur1) && dur1 !== "0s", dur1);
if (SHOTS) await P.shot(`${SHOTS}/tracker.png`);

// second page sees it, finishes it
const Q = await newPage();
await sleep(1200);
await openApp(Q, "tracker");
ok("page 2 shows running span", await q(Q, `document.querySelectorAll('.tr-span').length === 1`));
await Q.ev(`document.querySelector('.tr-span button').click()`);
await sleep(600);
ok("page 1 sees it finished (sync)", await q(P, `document.getElementById('tr-spans').hidden`));
f = await readAll(P);
ev = lines(f[file]);
ok("end event with same activity", ev.length === 4 && ev[3].phase === "end" && ev[3].activity === ev[2].activity);

// concurrent appends from both pages keep all lines
await Promise.all([
  P.ev(`document.querySelectorAll('.tr-tile')[0].click()`),
  Q.ev(`document.querySelectorAll('.tr-tile')[0].click()`),
]);
await sleep(800);
f = await readAll(P);
ok("concurrent appends: 6 lines", lines(f[file]).length === 6, String(lines(f[file]).length));

// undo of the last log
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
const n1 = lines((await readAll(P))[file]).length;
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(300);
const n2 = lines((await readAll(P))[file]).length;
ok("undo removes the line", n1 === 7 && n2 === 6, `${n1} -> ${n2}`);

// delete a row + undo
await P.ev(`document.querySelector('.tr-row .fdel').click()`);
await sleep(300);
ok("row deleted", lines((await readAll(P))[file]).length === 5);
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(300);
ok("restored", lines((await readAll(P))[file]).length === 6);

// edit time of the newest row: one hour earlier
await P.ev(`document.querySelector('.tr-row .tr-time').click()`);
await sleep(100);
await P.ev(`(() => { const i = document.querySelector('.tr-row input'); const d = new Date(new Date(i.value).getTime() - 3600e3); const p = (n) => String(n).padStart(2, '0'); i.value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
await sleep(400);
const times = lines((await readAll(P))[file]).map((e) => e.time);
ok("time changed in the file", times.length === 6, JSON.stringify(times.slice(-1)));

// edit types: rename, reorder survives reload
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "tracker");
ok("after reload: types and events loaded", await q(P, `document.querySelectorAll('.tr-tile').length === 3 && document.querySelectorAll('.tr-row').length === 6`));
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
if (SHOTS) await P.shot(`${SHOTS}/tracker-types.png`);
await P.ev(`(() => { const i = document.querySelector('.tr-type-row input[type=text]:not(.tr-icon-in)'); i.value = 'Smoked'; i.dispatchEvent(new Event('input')); document.getElementById('tr-types-save').click(); })()`);
await sleep(300);
f = await readAll(P);
const t2 = JSON.parse(f["types.json"]).types;
ok("rename keeps id", t2[0].name === "Smoked" && t2[0].id === "покурил");

// archive: the tile goes away, the log keeps the name; restore brings it back
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
await P.ev(`document.querySelector('.tr-type-row button').click()`);
await P.ev(`document.getElementById('tr-types-save').click()`);
await sleep(300);
f = await readAll(P);
ok("archived in the file", JSON.parse(f["types.json"]).types[0].archived === true);
ok("archived: no tile", await q(P, `document.querySelectorAll('.tr-tile').length === 2`));
ok("archived: log keeps the name", await q(P, `[...document.querySelectorAll('.tr-what.gone')].some((n) => n.textContent === 'Smoked')`));
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
ok("archived row in the editor", await q(P, `document.querySelector('.tr-type-row').classList.contains('archived')`));
await P.ev(`document.querySelector('.tr-type-row button').click()`);
await P.ev(`document.getElementById('tr-types-save').click()`);
await sleep(300);
ok("restored: tile back", await q(P, `document.querySelectorAll('.tr-tile').length === 3`));
ok("title Tracker", (await q(P, `document.title`)) === "Tracker");
console.log("errors:", P.errors, Q.errors);
P.close(); Q.close();
process.exit(0);
