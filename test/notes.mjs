/* notes scenario: create, autosave, rename, close panel, sessions, sync between pages, delete, download, a tab closed
   right after typing. run: node test/notes.mjs */
import { newPage, sleep, ok, resetData, dbAll, openApp, closeTab } from "./cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const notes = (P) => P.ev(dbAll("notes"));
const tabs = (P) => P.ev(`[...document.querySelectorAll('#tabs .tab-name')].map((n) => n.textContent)`);
const byName = async (P, name) => (await notes(P)).find((n) => n.name === name);

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);
await openApp(P, "notes");
ok("address has the route", (await P.ev(`location.hash`)) === "#/notes");

// two new notes
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(300);
await P.type("first line\nsecond");
await P.ev(`document.getElementById('tab-add').closest('.tabbar').querySelector('.tabs').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(300);
await P.type("two");
await sleep(700);
let all = await notes(P);
ok("two notes: “new1”, “new2”", all.length === 2 && (await byName(P, "new1"))?.text === "first line\nsecond" && (await byName(P, "new2"))?.text === "two");
ok("status says saved", /^saved /.test(await P.ev(`document.getElementById('st-save').textContent`)));

// rename by double-click on the tab: any string, no extension added
await P.ev(`document.querySelectorAll('#tabs .tab-name')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(100);
await P.ev(`(() => { const i = document.querySelector('.tab-rename'); i.value = 'plan'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
await sleep(300);
ok("renamed to “plan”", (await byName(P, "plan"))?.text === "two" && JSON.stringify(await tabs(P)) === '["new1","plan"]');

// a second page: opens with the session of the page used last, follows edits, renames and deletes
await sleep(300);
const Q = await newPage();
await sleep(1000);
await openApp(Q, "notes");
ok("page 2 opens the same tabs", JSON.stringify(await tabs(Q)) === '["new1","plan"]', JSON.stringify(await tabs(Q)));
await Q.ev(`document.querySelectorAll('#tabs .tab')[1].click()`);
await sleep(100);
await P.ev(`document.querySelectorAll('#tabs .tab')[1].click(); const t = document.getElementById('text'); t.focus(); t.setSelectionRange(3, 3)`);
await P.type(" more");
await sleep(1500); // P is a background tab now (Q opened last): its timers run once a second
ok("page 2 gets the text", (await Q.ev(`document.getElementById("text").value`)) === "two more" && (await byName(P, "plan"))?.text === "two more", JSON.stringify([await Q.ev(`document.getElementById("text").value`), (await byName(P, "plan"))?.text, await P.ev(`document.getElementById("text").value`)]));
await P.ev(`document.querySelectorAll('#tabs .tab-name')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await P.ev(`(() => { const i = document.querySelector('.tab-rename'); i.value = 'plan.md'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
await sleep(500);
ok("page 2 gets the new name", JSON.stringify(await tabs(Q)) === '["new1","plan.md"]', JSON.stringify(await tabs(Q)));

// download: the file is named exactly like the note
const dl = fs.mkdtempSync(path.join(os.tmpdir(), "ntab-dl-"));
await P.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
const nameless = (await notes(P)).find((n) => n.name === "new1");
await P.ev(`document.querySelectorAll('#tabs .tab')[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }))`);
await P.ev(`document.querySelector('.ctx-menu .ctx-item').click()`);
await sleep(800);
ok("downloaded as “new1” (no extension added)", fs.readdirSync(dl).join() === "new1" && fs.readFileSync(path.join(dl, "new1"), "utf8") === nameless.text, fs.readdirSync(dl).join());

// delete from the tab menu: gone here and on page 2
await P.ev(`document.querySelectorAll('#tabs .tab')[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }))`);
await P.ev(`document.querySelector('.ctx-menu .danger').click()`);
await sleep(500);
ok("deleted", (await notes(P)).length === 1 && JSON.stringify(await tabs(P)) === '["plan.md"]');
ok("page 2 closed its tab", JSON.stringify(await tabs(Q)) === '["plan.md"]');

// close panel: an edited new note asks for a name; an empty new note is deleted when closed
await P.ev(`document.getElementById('tabs').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(300);
await P.type("Shopping list\nmilk");
await sleep(500);
await P.ev(`document.querySelector('#tabs .tab.active .tab-x').click()`);
await sleep(100);
ok("close panel shows", await P.ev(`!document.getElementById('close-panel').hidden`));
await P.ev(`document.getElementById('cp-first').click(); document.getElementById('cp-save').click()`);
await sleep(500);
ok("saved under its first line", (await byName(P, "Shopping list"))?.text === "Shopping list\nmilk" && JSON.stringify(await tabs(P)) === '["plan.md"]');
await P.ev(`document.getElementById('tabs').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(300);
await P.ev(`document.querySelector('#tabs .tab.active .tab-x').click()`);
await sleep(400);
ok("empty new note deleted on close", (await notes(P)).length === 2);

// the [+] list opens a closed note
await P.ev(`document.getElementById('tab-add').click()`);
await sleep(300);
ok("[+] lists both notes", (await P.ev(`[...document.querySelectorAll('#files-list .fname')].map((n) => n.textContent).sort().join()`)) === "Shopping list,plan.md");
await P.ev(`[...document.querySelectorAll('#files-list .file-row')].find((r) => r.textContent.includes('Shopping')).click()`);
await sleep(300);
ok("opened from the list", JSON.stringify(await tabs(P)) === '["plan.md","Shopping list"]');

// reload: back at home, the tabs come back when Notes is opened
await P.send("Page.reload");
await sleep(1000);
ok("reload starts at home, no route", (await P.ev(`!document.getElementById('home').hidden && location.hash === ''`)));
await openApp(P, "notes");
ok("session restored after reload", JSON.stringify(await tabs(P)) === '["plan.md","Shopping list"]');

// typing and closing the browser tab at once: the text still lands
await P.type("!");
await closeTab(P);
await sleep(800);
ok("text typed right before closing the tab is saved", (await byName(Q, "Shopping list"))?.text.includes("!"), JSON.stringify((await byName(Q, "Shopping list"))?.text));

console.log("errors:", P.errors, Q.errors);
await Q.close();
process.exit(0);
