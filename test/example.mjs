/* smoke test: home screen -> notepad -> type -> the note is written. run: node test/example.mjs */
import { newPage, sleep, ok, resetData, dbAll, openApp } from "./cdp.mjs";

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
ok("starts on home", await P.ev(`!document.getElementById('home').hidden`));
// the GitHub corner and the version are out of the layout: no scroll from them; the transparent half takes no clicks
await P.ev(`document.querySelector('.home').scrollTop = 0`);
const corner = await P.ev(`(() => {
  const home = document.getElementById('home'), r = document.querySelector('.gh-corner').getBoundingClientRect();
  return { scroll: home.scrollHeight - home.clientHeight, fixed: getComputedStyle(document.querySelector('.gh-corner')).position,
    painted: !!document.elementFromPoint(innerWidth - 4, 4)?.closest('.gh-corner'),
    through: !document.elementFromPoint(r.left + 4, r.bottom - 4)?.closest('.gh-corner') };
})()`);
ok("corner: fixed, no scroll on home, only the triangle clicks", corner.scroll <= 0 && corner.fixed === "fixed" && corner.painted && corner.through, JSON.stringify(corner));
ok("version shown (no build outside the web version)", /^v\d+\.\d+\.\d+$/.test(await P.ev(`document.getElementById('app-ver').textContent`)), await P.ev(`document.getElementById('app-ver').textContent`));
await openApp(P, "notes");
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(500);
await P.type("hello");
await sleep(800);
const notes = await P.ev(dbAll("notes"));
ok("typed text saved as note “new1”", notes.length === 1 && notes[0].text === "hello" && notes[0].name === "new1", JSON.stringify(notes));
// sidebar arrows: in the flow above and below the icons, never over one; at the edge disabled, still there
await P.ev(resetData(Array.from({ length: 20 }, (_, i) => ({ name: `Site ${i}`, url: `https://s${i}.test` }))));
await P.send("Page.reload");
await sleep(1000);
const arrows = () => P.ev(`(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const list = r('links'), up = r('links-up'), down = r('links-down');
  return { up: up.height > 0, down: down.height > 0, upOff: document.getElementById('links-up').disabled,
    downOff: document.getElementById('links-down').disabled, clear: up.bottom <= list.top && down.top >= list.bottom,
    home: r('go-home').height };
})()`);
let a = await arrows();
ok("arrows shown outside the list, up disabled at the top", a.up && a.down && a.clear && a.upOff && !a.downOff, JSON.stringify(a));
ok("home button 48px like the icons", a.home === 48, a.home);
for (let i = 0; i < 6; i++) await P.ev(`document.getElementById('links-down').click()`), await sleep(150);
await sleep(600);
a = await arrows();
ok("at the bottom: down disabled but still in place", a.down && a.downOff && !a.upOff && a.clear, JSON.stringify(a));
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
a = await arrows();
ok("no arrows when the icons fit", !a.up && !a.down, JSON.stringify(a));

console.log("errors:", P.errors);
await P.close();
process.exit(0);
