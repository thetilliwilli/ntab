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
await openApp(P, "notes");
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(500);
await P.type("hello");
await sleep(800);
const notes = await P.ev(dbAll("notes"));
ok("typed text saved as note “new 1”", notes.length === 1 && notes[0].text === "hello" && notes[0].name === "new 1", JSON.stringify(notes));
console.log("errors:", P.errors);
P.close();
process.exit(0);
