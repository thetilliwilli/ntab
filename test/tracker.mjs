/* tracker scenario: types, events, activities, undo, time edit, sync between pages, records. run: node test/tracker.mjs (SHOTS=dir for screenshots) */
import { newPage, sleep, ok, resetData, dbAll, openApp } from "./cdp.mjs";

const SHOTS = process.env.SHOTS; // folder for screenshots, optional

const entries = async (P) => (await P.ev(dbAll("trackerEntries"))).sort((a, b) => a.at - b.at);
const typesOf = async (P) => (await P.ev(dbAll("trackerTypes"))).sort((a, b) => a.rank - b.rank);
const q = (P, js) => P.ev(js);

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "tracker");
ok("tracker open, no types", await q(P, `!document.getElementById('app-tracker').hidden && document.querySelectorAll('.tr-tile').length === 1`));

const addType = async (name, icon, span) => {
  await P.ev(`document.querySelector('.tr-tile.add').click()`);
  await sleep(100);
  await P.ev(`document.getElementById('tr-new-name').value = ${JSON.stringify(name)}; document.getElementById('tr-new-icon').value = ${JSON.stringify(icon)}; document.getElementById('tr-new-activity').checked = ${span}; document.getElementById('tr-new-form').requestSubmit()`);
  await sleep(300);
};
await addType("Покурил", "🚬", false);
await addType("Sleep", "🌙", true);
const types = await typesOf(P);
ok("types saved", types.length === 2 && types[0].name === "Покурил" && types[0].kind === "event" && types[1].kind === "activity" && types[1].archivedAt === null && types[1].rank === 1, JSON.stringify(types));

await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`); // already running: ignored
await sleep(300);
let ev = await entries(P);
ok("3 entries (2 events + 1 running activity)", ev.length === 3 && !("endAt" in ev[0]) && ev[2].endAt === null && ev[2].typeId === types[1].id, JSON.stringify(ev));
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
ev = await entries(P);
ok("the activity got its end", ev.length === 3 && ev[2].endAt >= ev[2].at);

// concurrent appends from both pages keep all lines
await Promise.all([
  P.ev(`document.querySelectorAll('.tr-tile')[0].click()`),
  Q.ev(`document.querySelectorAll('.tr-tile')[0].click()`),
]);
await sleep(800);
ok("concurrent logs: 5 entries", (await entries(P)).length === 5, String((await entries(P)).length));

// undo of the last log
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
const n1 = (await entries(P)).length;
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(300);
const n2 = (await entries(P)).length;
ok("undo removes the entry", n1 === 6 && n2 === 5, `${n1} -> ${n2}`);

// delete a row + undo
await P.ev(`document.querySelector('.tr-row .fdel').click()`);
await sleep(300);
ok("row deleted", (await entries(P)).length === 4);
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(300);
ok("restored", (await entries(P)).length === 5);

// edit time of the newest row: one hour earlier
await P.ev(`document.querySelector('.tr-row .tr-time').click()`);
await sleep(100);
await P.ev(`(() => { const i = document.querySelector('.tr-row input'); const d = new Date(new Date(i.value).getTime() - 3600e3); const p = (n) => String(n).padStart(2, '0'); i.value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
await sleep(400);
ev = await entries(P);
ok("time changed: one entry an hour back", ev.length === 5 && Date.now() - ev[0].at > 3500e3, JSON.stringify(ev[0]));

// the activity: its end time is editable too, and it can't end before it starts
const act = ev.find((e) => e.endAt);
await P.ev(`[...document.querySelectorAll('.tr-note .tr-time')][0].click()`);
await sleep(100);
await P.ev(`(() => { const i = document.querySelector('.tr-note input'); const d = new Date(${act.at} - 60e3); const p = (n) => String(n).padStart(2, '0'); i.value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
await sleep(300);
ok("end before start refused", (await entries(P)).find((e) => e.id === act.id).endAt === act.endAt && (await q(P, `document.getElementById('tr-toast').classList.contains('err')`)));

// edit types: rename, reorder survives reload
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "tracker");
ok("after reload: types and entries loaded", await q(P, `document.querySelectorAll('.tr-tile').length === 3 && document.querySelectorAll('.tr-row').length === 5`));
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
if (SHOTS) await P.shot(`${SHOTS}/tracker-types.png`);
await P.ev(`(() => { const i = document.querySelector('.tr-type-row input[type=text]:not(.tr-icon-in)'); i.value = 'Smoked'; i.dispatchEvent(new Event('input')); document.getElementById('tr-types-save').click(); })()`);
await sleep(300);
const t2 = await typesOf(P);
ok("rename keeps id", t2[0].name === "Smoked" && t2[0].id === types[0].id && t2[0].updatedAt > types[0].updatedAt && t2[1].updatedAt === types[1].updatedAt);

// archive: the tile goes away, the log keeps the name; restore brings it back
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
await P.ev(`document.querySelector('.tr-type-row button').click()`);
await P.ev(`document.getElementById('tr-types-save').click()`);
await sleep(300);
ok("archived: archivedAt set", (await typesOf(P))[0].archivedAt > 0);
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
