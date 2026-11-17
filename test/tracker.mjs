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
ok("types saved", types.length === 2 && types[0].name === "Покурил" && types[0].kind === "event" && types[1].kind === "activity" && types[1].archivedAt === null && types[1].rank > types[0].rank, JSON.stringify(types));

await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`);
await sleep(300);
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`);
await sleep(300);
let ev = await entries(P);
ok("3 entries (2 events + 1 running activity)", ev.length === 3 && !("endAt" in ev[0]) && ev[2].endAt === null && ev[2].typeId === types[1].id, JSON.stringify(ev));
ok("running activity in the log, no Finish button (the tile finishes it)", await q(P, `document.querySelectorAll('.tr-row.live').length === 1 && !document.querySelector('.tr-row button:not(.fdel)')`));
ok("running tile and row lit alike, with the accent", await q(P, `(() => { const t = document.querySelector('.tr-tile.running'), b = document.querySelector('.tr-tile:not(.running)'), r = document.querySelector('.tr-row.live'), bg = (n) => getComputedStyle(n).backgroundColor;
  return !!t && bg(t) !== bg(b) && bg(r) === bg(t) && getComputedStyle(r).color === getComputedStyle(t).color; })()`));
ok("one list: the running activity is not twice", await q(P, `document.querySelectorAll('#tr-log .tr-row').length === 3`));
ok("tile says ×2", await q(P, `document.querySelector('.tr-tile .tr-tile-meta').textContent.includes('×2')`));
await sleep(1500);
const dur1 = await q(P, `[document.querySelector('.tr-row.live .tr-len span').textContent, parseFloat(document.querySelector('.tr-row.live .tr-len i').style.width), document.querySelector('.tr-tile.running .tr-tile-meta').textContent]`);
ok("duration in minutes in the row and on the tile", dur1[0] === "0m" && dur1[1] > 0 && dur1[2] === "■ 0m", JSON.stringify(dur1));
if (SHOTS) await P.shot(`${SHOTS}/tracker.png`);

// second page sees it, finishes it
const Q = await newPage();
await sleep(1200);
await openApp(Q, "tracker");
ok("page 2 shows the running activity", await q(Q, `document.querySelectorAll('.tr-row.live').length === 1`));
await Q.ev(`document.querySelector('.tr-tile.running').click()`); // the same tile finishes it
await sleep(600);
ok("page 1 sees it finished (sync)", await q(P, `!document.querySelector('.tr-row.live') && !document.querySelector('.tr-tile.running')`));
ev = await entries(P);
ok("the activity got its end", ev.length === 3 && ev[2].endAt >= ev[2].at);
await P.ev(`document.querySelectorAll('.tr-tile')[0].click()`); // an event after it: the log is by time only
await sleep(400);
ok("one list by time, newest first", await q(P, `(() => { const r = [...document.querySelectorAll('#tr-log .tr-row')]; return r.length === 4 && r[0].querySelector('.tr-what').textContent === 'Покурил' && r[1].querySelector('.tr-what').textContent === 'Sleep'; })()`));
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`); // starts again: the newest, on top by time
await sleep(400);
ok("started again: on top because it is the newest", await q(P, `document.querySelector('#tr-log .tr-row').classList.contains('live')`));
await P.ev(`document.querySelector('.tr-tile.running').click()`);
await sleep(400);
await P.ev(`document.getElementById('tr-toast-undo').click()`); // undo the finish: runs again
await sleep(400);
ok("undo of a finish from the tile: runs again", await q(P, `!!document.querySelector('.tr-tile.running')`));
await P.ev(`document.querySelector('.tr-tile.running').click()`);
await sleep(400);
const extra = (await entries(P)).slice(3).map((e) => e.id); // back to the 3 entries the steps below count on
await P.ev(`import('/shared/db.js').then((db) => db.remove('trackerEntries', ${JSON.stringify(extra)}))`);
await sleep(400);
ok("cleanup: 3 entries again", (await entries(P)).length === 3);

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

// edit times: a click on a row (anywhere but ×) opens the editor (YYYY-MM-DD and 24-hour HH:MM); the start, and the finish
// of an activity. shown to the minute; saving an unchanged minute keeps the stored milliseconds
const setFields = (k, t) => `(() => { const d = new Date(${t}); const p = (n) => String(n).padStart(2, '0');
  document.getElementById('tr-${k}-date').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  document.getElementById('tr-${k}-hm').value = p(d.getHours()) + ':' + p(d.getMinutes()); })()`;
const save = () => P.ev(`document.getElementById('tr-time-form').requestSubmit()`);
const isOpen = () => q(P, `document.getElementById('tr-time').open`);
const before = (await entries(P)).map((e) => e.at).join();
ok("log: start to the minute, then the duration (no finish time)", await q(P, `/^\\d\\d:\\d\\d$/.test(document.querySelector('.tr-row .tr-start').textContent) && [...document.querySelectorAll('.tr-row')].some((r) => /^\\d+m$/.test(r.children[1].textContent))`));
await P.ev(`document.querySelector('.tr-row .fdel').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); // × doesn't open the editor
await sleep(300);
ok("× deletes, doesn't open the editor", !(await isOpen()) && (await entries(P)).length === 4);
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(300);
const evRow = `[...document.querySelectorAll('.tr-row')].find((r) => !r.children[1].textContent)`; // an event's row
await P.ev(`${evRow}.querySelector('.tr-what').click()`);
await sleep(100);
const shown = await q(P, `[document.getElementById('tr-time').open, document.getElementById('tr-at-date').value, document.getElementById('tr-at-hm').value, document.getElementById('tr-end-box').hidden]`);
ok("event: the editor with its time only; ISO date, 24-hour time", shown[0] && /^\d{4}-\d\d-\d\d$/.test(shown[1]) && /^([01]\d|2[0-3]):\d\d$/.test(shown[2]) && shown[3], JSON.stringify(shown));
if (SHOTS) await P.shot(`${SHOTS}/tracker-time.png`);
// the system pickers: the button hands the field's value to a native date / time input, what it picks comes back in our format
await P.ev(`document.getElementById('tr-at-hm-pick').click(); document.getElementById('tr-at-date-pick').click()`);
const sys = await q(P, `[document.getElementById('tr-at-date-sys').value, document.getElementById('tr-at-hm-sys').value]`);
ok("picker gets the field's value", sys[0] === shown[1] && sys[1] === shown[2], JSON.stringify(sys));
await P.ev(`(() => { const d = document.getElementById('tr-at-date-sys'), t = document.getElementById('tr-at-hm-sys');
  d.value = '2026-01-02'; d.dispatchEvent(new Event('change')); t.value = '21:05'; t.dispatchEvent(new Event('change')); })()`);
ok("picked values in the fields: ISO date, 24 hours", (await q(P, `document.getElementById('tr-at-date').value + ' ' + document.getElementById('tr-at-hm').value`)) === "2026-01-02 21:05");
await P.ev(`document.getElementById('tr-at-date').value = ${JSON.stringify(shown[1])}; document.getElementById('tr-at-hm').value = ${JSON.stringify(shown[2])}`);
await save();
await sleep(300);
ok("unchanged minute keeps the exact time", (await entries(P)).map((e) => e.at).join() === before && !(await isOpen()));
await P.ev(`${evRow}.click()`);
await sleep(100);
await P.ev(`document.getElementById('tr-at-hm').value = '25:00'`);
await save();
await sleep(200);
ok("a wrong time is refused", (await isOpen()) && (await q(P, `document.getElementById('tr-time-msg').textContent.includes('HH:MM')`)));
const target = await q(P, `${evRow}.querySelector('.tr-start').textContent`);
const victimId = await q(P, `${evRow}.dataset.id`);
const victim = (await entries(P)).find((e) => e.id === victimId);
await P.ev(setFields("at", `Math.max(${victim.at} - 3600e3, new Date().setHours(0, 0, 1, 0))`)); // back, but still today
await P.ev(`document.querySelector('#tr-at-box [data-min="-5"]').click(); document.querySelector('#tr-at-box [data-min="5"]').click()`); // −5 +5: the same
await save();
await sleep(400);
ev = await entries(P);
ok("time changed: the event moved back", ev.length === 5 && ev.find((e) => e.id === victim.id).at < victim.at - 30e3, JSON.stringify({ target, victim }));

// the activity: start and finish in one editor, both change in one save; it can't end before it starts
const act = ev.find((e) => e.endAt);
await P.ev(`document.querySelector('.tr-row:not(.live) .tr-len span')?.closest('.tr-row').click()`);
await sleep(100);
ok("activity: start and finish shown", await q(P, `!document.getElementById('tr-end-box').hidden && /^\\d\\d:\\d\\d$/.test(document.getElementById('tr-end-hm').value)`));
await P.ev(setFields("end", `${act.at} - 120e3`));
await save();
await sleep(300);
ok("end before start refused", (await entries(P)).find((e) => e.id === act.id).endAt === act.endAt && (await q(P, `document.getElementById('tr-time-msg').textContent.includes("can't end")`)));
await P.ev(setFields("at", `${act.at} - 600e3`));
await P.ev(setFields("end", `${act.at} - 300e3`)); // both earlier: the finish before the old start, fine in one save
await save();
await sleep(300);
const moved = (await entries(P)).find((e) => e.id === act.id);
ok("start and finish changed together", !(await isOpen()) && moved.endAt - moved.at === 300e3 && moved.endAt < act.at, JSON.stringify(moved));
// a running one: the finish is empty; empty keeps it running, filled in it finishes it
await P.ev(`document.querySelectorAll('.tr-tile')[1].click()`);
await sleep(400);
await P.ev(`document.querySelector('.tr-row.live').click()`);
await sleep(100);
ok("running: the finish is empty", await q(P, `document.getElementById('tr-end-hm').value === '' && document.getElementById('tr-end-date').value === ''`));
await save();
await sleep(300);
ok("empty finish keeps it running", !(await isOpen()) && (await q(P, `!!document.querySelector('.tr-row.live')`)));
await P.ev(`document.querySelector('.tr-row.live').click()`);
await sleep(100);
await P.ev(`document.querySelector('#tr-end-box [data-min="now"]').click()`);
await save();
await sleep(400);
ok("finish filled in: finished", await q(P, `!document.querySelector('.tr-row.live') && !document.querySelector('.tr-tile.running')`));
const extra2 = (await entries(P)).filter((e) => e.at > Date.now() - 5e3 && e.endAt).map((e) => e.id);
await P.ev(`import('/shared/db.js').then((db) => db.remove('trackerEntries', ${JSON.stringify(extra2)}))`);
await sleep(400);

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

// delete all log entries (the types stay), after a confirm; the other page follows; undo brings them back
const logged = (await entries(P)).length;
const typeCount = (await typesOf(P)).length;
await P.ev(`document.getElementById('tr-edit').click()`);
await sleep(200);
await P.ev(`window.confirm = () => false; document.getElementById('tr-clear').click()`);
await sleep(200);
ok("delete all: declined confirm keeps the log", (await entries(P)).length === logged && logged > 0, logged);
await P.ev(`window.confirm = (m) => (window.asked = m, true); document.getElementById('tr-clear').click()`);
await sleep(400);
ok("delete all: asked with the count", (await q(P, `window.asked`)) === `Delete all ${logged} log entries? The event types stay.`);
const kept = [(await entries(P)).length, (await typesOf(P)).length];
ok("delete all: no entries, types stay", kept[0] === 0 && kept[1] === typeCount, JSON.stringify(kept));
ok("delete all: dialog closed, toast with undo", await q(P, `!document.getElementById('tr-types').open && !document.getElementById('tr-toast').hidden && !document.getElementById('tr-toast-undo').hidden`));
await sleep(600);
await openApp(Q, "tracker");
ok("delete all: the other page's log is empty", await q(Q, `document.querySelectorAll('#tr-log .tr-row').length === 0`));
await P.ev(`document.getElementById('tr-toast-undo').click()`);
await sleep(400);
ok("delete all: undo restores them", (await entries(P)).length === logged);

// a phone: the log rows fit the screen
await P.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 760, deviceScaleFactor: 1, mobile: true });
await sleep(300);
ok("phone: log rows fit", await q(P, `[...document.querySelectorAll('.tr-row')].every((r) => r.scrollWidth <= r.clientWidth) && document.querySelector('.tr-body').scrollWidth <= document.querySelector('.tr-body').clientWidth`));
if (SHOTS) await P.shot(`${SHOTS}/tracker-phone.png`);
console.log("errors:", P.errors, Q.errors);
await P.close(); await Q.close();
process.exit(0);
