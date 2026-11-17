/* smoke test: home screen -> notepad -> type -> the note is written; the bottom navigation and the start screen.
   run: node test/example.mjs */
import { newPage, sleep, ok, resetData, dbAll, openApp } from "./cdp.mjs";

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
ok("starts on home", await P.ev(`!document.getElementById('home').hidden`));
// home: no corner link, the tiles near the top; the version is in Settings → About
ok("home: tiles near the top, no corner", (await P.ev(`document.querySelector('#home-grid .tile').getBoundingClientRect().top`)) < 40 && !(await P.ev(`document.querySelector('.gh-corner')`)));
ok("about: version (no build outside the web version), GitHub link", /^v\d+\.\d+\.\d+$/.test(await P.ev(`document.getElementById('app-ver').textContent`)) && (await P.ev(`document.getElementById('app-build').hidden`)) && (await P.ev(`(() => { const a = document.getElementById('app-repo'); return a.href + ' ' + a.target + ' ' + a.rel; })()`)) === "https://github.com/thetilliwilli/ntab _blank noopener noreferrer", await P.ev(`document.getElementById('app-ver').textContent`));
await openApp(P, "notes");
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(500);
await P.type("hello");
await sleep(800);
const notes = await P.ev(dbAll("notes"));
ok("typed text saved as note “new1”", notes.length === 1 && notes[0].text === "hello" && notes[0].name === "new1", JSON.stringify(notes));
// the bottom navigation: the screen in front is lit, its own buttons come after the separator
const nav = () => P.ev(`(() => ({
  on: [...document.querySelectorAll('#bnav .on')].map((b) => b.dataset.view).join(),
  ctx: [...document.querySelectorAll('#bnav [data-for]')].filter((b) => !b.hidden).map((b) => b.id).join(),
  title: document.title,
  pos: [...document.querySelectorAll('#bnav [data-view], #bnav .bnav-sep, #bnav-ctx')].map((b) => { const r = b.getBoundingClientRect(); return r.left + ',' + r.width; }).join(' '),
}))()`);
let n = await nav();
const pos0 = n.pos;
const still = (n) => ok("nav: nothing in the bar moves", n.pos === pos0, n.pos + " / " + pos0);
ok("nav: notes lit, no buttons of its own", n.on === "notes" && n.ctx === "" && n.title === "Notes", JSON.stringify(n));
await openApp(P, "tracker");
n = await nav();
ok("nav: tracker lit, Types after the separator", n.on === "tracker" && n.ctx === "tr-edit", JSON.stringify(n));
still(n);
await openApp(P, "board");
n = await nav();
ok("nav: board lit, Task", n.on === "board" && n.ctx === "bd-new", JSON.stringify(n));
still(n);
await openApp(P, "home");
n = await nav();
ok("nav: home lit, Edit (actions)", n.on === "home" && n.ctx === "links-edit" && n.title === "new", JSON.stringify(n));
still(n);
await openApp(P, "settings");
n = await nav();
ok("nav: settings lit, the screen shown", n.on === "settings" && n.ctx === "" && !(await P.ev(`document.getElementById('settings').hidden`)), JSON.stringify(n));
still(n);
// the start screen of this device
ok("start screen: auto marked", (await P.ev(`document.querySelector('#set-start .on').dataset.value`)) === "auto");
await P.ev(`document.querySelector('#set-start [data-value=board]').click()`);
await sleep(300);
await P.ev(`location.hash = "#/notes"`); // a route typed into the address opens its screen
await sleep(300);
ok("a typed route opens its screen", (await nav()).on === "notes");
await P.send("Page.reload");
await sleep(1200);
n = await nav();
ok("a reload opens the chosen start screen (the address doesn't matter)", n.on === "board" && (await P.ev(`location.hash`)) === "#/board", JSON.stringify(n));
await openApp(P, "settings");
await P.ev(`document.querySelector('#set-start [data-value=auto]').click()`);
await sleep(300);
// auto: a touch screen (a phone) starts on the tracker
await P.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await P.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await P.send("Page.reload");
await sleep(1200);
n = await nav();
ok("auto on a phone: tracker", n.on === "tracker", JSON.stringify(n));
const fit = await P.ev(`(() => { const r = document.getElementById('bnav').getBoundingClientRect(); return { bottom: r.bottom, h: innerHeight, w: document.documentElement.scrollWidth }; })()`);
ok("phone: the navigation at the bottom, no sideways scroll", fit.bottom === fit.h && fit.w === 390, JSON.stringify(fit));
if (process.env.SHOTS) await P.shot(`${process.env.SHOTS}/phone-tracker.png`);
const phonePos = new Set();
for (const v of ["home", "notes", "tracker", "board", "settings"]) await openApp(P, v), phonePos.add((await nav()).pos);
ok("phone: nothing in the bar moves between screens", phonePos.size === 1, [...phonePos].join(" / "));
// a touch screen: opening Notes (a note open, or the list) focuses no text field, so no keyboard pops up
await openApp(P, "notes");
const typing = () => P.ev(`(() => { const a = document.activeElement; return a?.matches('textarea, input') ? a.id : ''; })()`);
ok("phone: Notes with a note open focuses nothing", (await typing()) === "", await typing());
await P.ev(`document.querySelector('.tab')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))`);
await P.ev(`[...document.querySelectorAll('.ctx-menu:not([hidden]) .ctx-item')].find((b) => b.textContent === 'Delete note')?.click()`);
await sleep(300);
await openApp(P, "home");
await openApp(P, "notes");
ok("phone: Notes with the list focuses nothing", (await P.ev(`!document.getElementById('nothing').hidden`)) && (await typing()) === "", await typing());
await P.send("Emulation.setTouchEmulationEnabled", { enabled: false });
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await P.send("Page.reload");
await sleep(1200);
ok("auto on a computer: home", (await nav()).on === "home");

console.log("errors:", P.errors);
await P.close();
process.exit(0);
