/* smoke test: home screen -> notepad -> type -> the file is written. run: node test/example.mjs */
import { newPage, sleep, ok, notesDir } from "./cdp.mjs";

const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
await P.ev(`(async () => { localStorage.clear(); const d = ${notesDir}; for await (const k of d.keys()) await d.removeEntry(k); })()`);
await P.send("Page.reload");
await sleep(1200);
ok("starts on home", await P.ev(`!document.getElementById('home').hidden`));
await P.ev(`document.querySelector('#links .notes').click()`);
await sleep(500);
await P.ev(`document.getElementById('gate-btn').click()`); // stub picker grants the OPFS folder
await sleep(800);
await P.ev(`document.getElementById('nothing-new').click()`);
await sleep(500);
await P.type("hello");
await sleep(800);
const text = await P.ev(`(async () => { const d = ${notesDir}; return (await (await d.getFileHandle('new1.txt')).getFile()).text(); })()`);
ok("typed text saved to new1.txt", text === "hello", JSON.stringify(text));
console.log("errors:", P.errors);
P.close();
process.exit(0);
