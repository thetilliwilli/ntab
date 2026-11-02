/* data scenario: backup reminder, export, import (backup and text files), routes, actions editor and add-link.
   run: node test/data.mjs */
import { newPage, sleep, ok, resetData, dbAll, inDb, openApp } from "./cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ntab-data-"));
const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await P.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: tmp });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData());
await P.send("Page.reload");
await sleep(1000);

/* file pickers: the page's <input type=file> is caught and given these files */
const catchPicker = () => P.ev(`(() => {
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === "file") window.__picker = this; else click.call(this); };
})()`);
async function pick(files) {
  await sleep(200);
  const { result } = (await P.send("Runtime.evaluate", { expression: "window.__picker" })).result;
  await P.send("DOM.enable");
  await P.send("DOM.setFileInputFiles", { files, objectId: result.objectId });
  await sleep(500);
}

// reminder: not with no data, yes once due and there is data; Later snoozes it
ok("no reminder without data", await P.ev(`document.getElementById('backup-bar').hidden`));
await P.ev(inDb(`async (s) => {
  s.tasks.put({ id: "t1", name: "Task", description: "", status: "new", rank: 0, createdAt: 1, updatedAt: 1 });
  s.meta.put({ lastExportAt: null, remindAt: Date.now() - 1 }, "backup");
}`));
await P.send("Page.reload");
await sleep(1000);
ok("reminder shows", await P.ev(`!document.getElementById('backup-bar').hidden && document.getElementById('backup-text').textContent.startsWith('No backup yet')`));
await P.ev(`document.getElementById('backup-later').click()`);
await sleep(300);
const snoozed = await P.ev(inDb(`async (s, req) => req(s.meta.get("backup"))`, "readonly"));
ok("Later: hidden, back in 3 days", (await P.ev(`document.getElementById('backup-bar').hidden`)) && Math.abs(snoozed.remindAt - Date.now() - 3 * 864e5) < 60e3);

// export from the data dialog
await P.ev(`document.getElementById('data-btn').click()`);
await sleep(200);
ok("data dialog: no backup yet", (await P.ev(`document.getElementById('data-last').textContent`)) === "no backup yet");
await P.ev(`document.getElementById('data-export').click()`);
await sleep(1000);
const file = fs.readdirSync(tmp).find((f) => f.startsWith("ntab-backup-"));
const backup = file && JSON.parse(fs.readFileSync(path.join(tmp, file), "utf8"));
ok("backup file", backup?.app === "ntab" && backup.format === 1 && backup.data.tasks.length === 1 && backup.data.actions.length === 3 && "settings" in backup.data, file);
const info = await P.ev(inDb(`async (s, req) => req(s.meta.get("backup"))`, "readonly"));
ok("export remembered, next reminder in a week", Date.now() - info.lastExportAt < 10e3 && Math.abs(info.remindAt - Date.now() - 7 * 864e5) < 60e3);
ok("dialog shows the last backup", (await P.ev(`document.getElementById('data-last').textContent`)).startsWith("last backup:"));

// text files become notes, named like the files
fs.writeFileSync(path.join(tmp, "todo.md"), "# todo\n- a");
fs.writeFileSync(path.join(tmp, "plain"), "no extension");
await catchPicker();
await P.ev(`document.getElementById('data-text').click()`);
await pick([path.join(tmp, "todo.md"), path.join(tmp, "plain")]);
const notes = await P.ev(dbAll("notes"));
ok("text files imported as notes", notes.length === 2 && notes.some((n) => n.name === "todo.md" && n.text === "# todo\n- a") && notes.some((n) => n.name === "plain"), JSON.stringify(notes.map((n) => n.name)));

// import: a broken file is refused; a backup only adds what is missing (by id), nothing here changes or goes
fs.writeFileSync(path.join(tmp, "bad.json"), JSON.stringify({ app: "ntab", format: 1, data: { settings: {}, notes: [{ id: "x" }] } }));
await P.ev(`document.getElementById('data-import').click()`);
await pick([path.join(tmp, "bad.json")]);
ok("broken backup refused", /bad\.json: notes\[0\]: "name" must be a string/.test(await P.ev(`document.getElementById('data-msg').textContent`)), await P.ev(`document.getElementById('data-msg').textContent`));
const Q = await newPage(); // another tab: hears about the added records
await sleep(1000);
await openApp(Q, "board");
backup.data.settings = { ...backup.data.settings, fontSize: 20 };
backup.data.tasks[0].name = "Changed in the backup"; // same id as the task here: the one here stays
backup.data.tasks.push({ id: "t2", name: "From the backup", description: "", status: "new", rank: -5, createdAt: 2, updatedAt: 2 });
backup.data.notes.push({ id: "n9", name: "backup note", text: "x", createdAt: 2, updatedAt: 2 });
fs.writeFileSync(path.join(tmp, "good.json"), JSON.stringify(backup));
await P.ev(`window.confirm = () => { throw new Error("no confirm for a merge") }`);
await P.ev(`document.getElementById('data-import').click()`);
await pick([path.join(tmp, "good.json")]);
await sleep(1000);
const tasks = (await P.ev(dbAll("tasks"))).sort((a, b) => a.rank - b.rank);
ok("merge: notes here stay, the new one added", (await P.ev(dbAll("notes"))).map((n) => n.name).sort().join() === "backup note,plain,todo.md");
ok("merge: the task here unchanged, the new one after it", tasks.map((t) => `${t.id}:${t.name}:${t.rank}`).join() === "t1:Task:0,t2:From the backup:1", JSON.stringify(tasks));
ok("merge: settings here stay", (await P.ev(inDb(`async (s, req) => req(s.meta.get("settings"))`, "readonly")))?.fontSize !== 20);
ok("merge: the result is said", (await P.ev(`document.getElementById('data-msg').textContent`)) === "good.json: added 1 notes, 1 tasks; 4 already here, kept as they are.", await P.ev(`document.getElementById('data-msg').textContent`));
ok("merge: the other tab shows the new task", await Q.ev(`[...document.querySelectorAll('#bd-cols .bd-card, #bd-cols [class*=card]')].some((c) => c.textContent.includes('From the backup'))`));
await P.ev(`window.confirm = () => true`);
await P.ev(inDb(`async (s) => { s.notes.clear(); s.tasks.delete("t2"); }`)); // the rest of the scenario starts from the old state
await P.send("Page.reload");
await sleep(1000);

// routes: an app is "#/<id>"; typing one in the address opens it
await P.ev(`location.hash = '#/board'`);
await sleep(500);
ok("#/board opens the board", await P.ev(`!document.getElementById('app-board').hidden && document.title === 'Board'`));
await P.ev(`document.getElementById('go-home').click()`);
await sleep(200);
ok("home clears the route", await P.ev(`location.hash === '' && !document.getElementById('home').hidden`));
ok("home: one list, no groups", await P.ev(`!document.querySelector('.home-head') && document.querySelectorAll('#home-grid .tile').length === 4`));

// add a link from the home tile
await P.ev(`document.querySelector('.tile-add').click()`);
await sleep(100);
await P.ev(`document.getElementById('add-url').value = 'example.com'; document.getElementById('add-blank').checked = true; document.getElementById('add-form').requestSubmit()`);
await sleep(400);
let actions = (await P.ev(dbAll("actions"))).sort((a, b) => a.rank - b.rank);
const ex = actions.at(-1);
ok("link added as an open action", ex.name === "example.com" && ex.kind === "open" && ex.options.url === "https://example.com" && ex.options.newTab === true && ex.rank === 3, JSON.stringify(ex));
ok("tile is a link in a new tab", await P.ev(`(() => { const a = [...document.querySelectorAll('#home-grid a.tile')].at(-1); return a.href === 'https://example.com/' && a.target === '_blank'; })()`));

// actions editor, JSON mode: reorder and rename, a new action without id, a wrong route is refused
await P.ev(`document.getElementById('links-edit').click()`);
await sleep(200);
await P.ev(`document.getElementById('sc-mode-json').click()`);
const json = JSON.parse(await P.ev(`document.getElementById('sc-json-text').value`));
ok("JSON: id, name, kind, options", json.length === 4 && Object.keys(json[0]).join() === "id,name,kind,options" && json[0].options.url === "#/notes");
const setJson = (v) => P.ev(`document.getElementById('sc-json-text').value = ${JSON.stringify(JSON.stringify(v))}; document.getElementById('sc-save').click()`);
await setJson([...json, { name: "Bad", kind: "open", options: { url: "#/nope" } }]);
await sleep(200);
ok("unknown route refused", /item 5: "#\/nope" is not an app/.test(await P.ev(`document.getElementById("sc-json-err").textContent`)), await P.ev(`document.getElementById("sc-json-err").textContent + " / " + document.getElementById("sc-msg").textContent`));
await setJson([json[3], { ...json[0], name: "Notepad" }, { name: "Wiki", kind: "open", options: { url: "en.wikipedia.org" } }]);
await sleep(400);
actions = (await P.ev(dbAll("actions"))).sort((a, b) => a.rank - b.rank);
ok("saved in the new order", actions.map((a) => a.name).join() === "example.com,Notepad,Wiki" && actions[1].id === json[0].id && actions[2].options.url === "https://en.wikipedia.org" && actions[2].icon === null, JSON.stringify(actions));
ok("sidebar follows", (await P.ev(`[...document.querySelectorAll('#links > *')].map((n) => n.getAttribute('aria-label')).join()`)) === "example.com,Notepad,Wiki");

// right-click on a tile: Edit opens the form with the action, saving keeps its id and place; Delete removes it
const tileNamed = (n) => `[...document.querySelectorAll('#home-grid .tile')].find((t) => t.querySelector('.tile-name')?.textContent === ${JSON.stringify(n)})`;
await P.ev(`${tileNamed("Notepad")}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }))`);
ok("tile menu: Edit, Delete", (await P.ev(`[...document.querySelectorAll('.ctx-menu:not([hidden]) .ctx-item')].map((b) => b.textContent).join()`)) === "Edit,Delete");
await P.ev(`document.querySelector('.ctx-menu .ctx-item').click()`);
await sleep(100);
ok("Edit opens the form", await P.ev(`document.getElementById('add').open && document.getElementById('add-title').textContent === 'Edit action' && document.getElementById('add-url').value === '#/notes'`));
await P.ev(`document.getElementById('add-name').value = 'My notes'; document.getElementById('add-form').requestSubmit()`);
await sleep(400);
actions = (await P.ev(dbAll("actions"))).sort((a, b) => a.rank - b.rank);
ok("edited in place", actions.map((a) => a.name).join() === "example.com,My notes,Wiki" && actions[1].id === json[0].id && actions[1].rank === 1, JSON.stringify(actions.map((a) => [a.name, a.rank])));
// the sidebar: the flyout covers the icon, right-click on it gives the same menu
await P.ev(`document.querySelector('#links [aria-label=Wiki]').dispatchEvent(new MouseEvent('mouseenter'))`);
await P.ev(`document.querySelector('.flyout').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 200 }))`);
await P.ev(`document.querySelector('.ctx-menu .danger').click()`);
await sleep(400);
ok("Delete from the sidebar", (await P.ev(dbAll("actions"))).map((a) => a.name).sort().join() === "My notes,example.com" && (await P.ev(`!${tileNamed("Wiki")}`)));

// Embed icons: cached favicons go into the actions (the stub's cache has one for s1.test); Reset icons drops them all
await P.ev(resetData([{ name: "Notes", url: "#/notes" }, { name: "One", url: "https://s1.test/" }, { name: "Two", url: "https://s2.test/" }]));
await P.send("Page.reload");
await sleep(1000);
await P.ev(`document.getElementById('links-edit').click()`);
await sleep(300);
await P.ev(`document.getElementById('sc-embed').click()`);
await sleep(800);
ok("embed: the message", (await P.ev(`document.getElementById('sc-msg').textContent`)) === "1 icon embedded, 1 not in the browser's cache (they keep the letter). Save to keep.", await P.ev(`document.getElementById('sc-msg').textContent`));
ok("embed: nothing saved before Save", (await P.ev(dbAll("actions"))).every((a) => a.icon === null));
await P.ev(`document.getElementById('sc-save').click()`);
await sleep(400);
let icons = Object.fromEntries((await P.ev(dbAll("actions"))).map((a) => [a.name, a.icon]));
ok("embed: s1.test has a 128px PNG, the others none", /^data:image\/png;base64,/.test(icons.One) && icons.Two === null && icons.Notes === null);
ok("embed: 128×128", (await P.ev(`new Promise((r) => { const i = new Image(); i.onload = () => r(i.width + 'x' + i.height); i.src = ${JSON.stringify(icons.One)}; })`)) === "128x128");
await P.ev(`document.getElementById('links-edit').click()`);
await sleep(300);
ok("↺ only on the row with its own icon", (await P.ev(`[...document.querySelectorAll('#sc-rows .sc-reset')].map((b) => b.style.visibility !== 'hidden').join()`)) === "false,true,false");
await P.ev(`document.querySelectorAll('#sc-rows .sc-reset')[1].click()`);
await sleep(200);
ok("↺: the row is automatic again (in the draft)", await P.ev(`[...document.querySelectorAll('#sc-rows .sc-reset')].every((b) => b.style.visibility === 'hidden')`));
await P.ev(`document.getElementById('sc-cancel').click()`);
await P.ev(`document.getElementById('links-edit').click()`);
await sleep(300);
await P.ev(`document.getElementById('sc-reset-icons').click()`);
await sleep(200);
ok("reset: the message", (await P.ev(`document.getElementById('sc-msg').textContent`)) === "1 icon back to automatic. Save to keep.");
await P.ev(`document.getElementById('sc-save').click()`);
await sleep(400);
ok("reset: every icon automatic", (await P.ev(dbAll("actions"))).every((a) => a.icon === null));

// Delete all data: after a confirm the database and the cached theme go, both pages start fresh (default actions)
await P.ev(`localStorage.setItem('theme', 'dark')`);
await Q.send("Page.reload");
await sleep(1000);
await Q.ev(`window.marker = 1`);
const before = (await P.ev(dbAll("notes"))).length + (await P.ev(dbAll("actions"))).length;
await P.ev(`document.getElementById('data-btn').click()`);
await P.ev(`window.confirm = () => false; document.getElementById('data-wipe').click()`);
await sleep(300);
ok("wipe: declined keeps the data", (await P.ev(dbAll("notes"))).length + (await P.ev(dbAll("actions"))).length === before && before > 0);
await P.ev(`window.confirm = () => true; document.getElementById('data-wipe').click()`);
await sleep(2000);
const fresh = { notes: (await P.ev(dbAll("notes"))).length, actions: (await P.ev(dbAll("actions"))).map((a) => a.name).join(),
  theme: await P.ev(`localStorage.getItem('theme')`), home: await P.ev(`!document.getElementById('home').hidden`) };
ok("wipe: no notes, default actions, theme back to auto, home", fresh.notes === 0 && fresh.actions.split(",").length === 5 && fresh.theme !== "dark" && fresh.home, JSON.stringify(fresh));
ok("wipe: the other tab reloaded", (await Q.ev(`window.marker ?? 'reloaded'`)) === "reloaded");

console.log("errors:", P.errors, Q.errors);
await P.close();
await Q.close();
process.exit(0);
