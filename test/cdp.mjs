/* helpers for driving test.html in headless Chrome over CDP; see "Testing" in CLAUDE.md */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CDP = "http://127.0.0.1:9333";
export const PAGE = "http://localhost:8765/test.html";

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = []; // uncaught exceptions + console errors/warnings
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description);
    if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type))
      errors.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression) => {
    const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send,
    ev,
    errors,
    close: () => ws.close(),
    type: (text) => send("Input.insertText", { text }),
    click: async (x, y, button = "left") => {
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
    },
    shot: async (file) => (await import("node:fs")).writeFileSync(file, Buffer.from((await send("Page.captureScreenshot")).result.data, "base64")),
  };
}

/* opens a new tab with the test page */
export async function newPage() {
  const target = await (await fetch(`${CDP}/json/new?${PAGE}`, { method: "PUT" })).json();
  const P = await connect(target.webSocketDebuggerUrl);
  P.id = target.id;
  return P;
}

/* closes the browser tab, like the user does */
export const closeTab = (P) => fetch(`${CDP}/json/close/${P.id}`);

export const ok = (label, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", label, extra);

/* expression: runs fn(stores) (source of an async function) over the app's IndexedDB in one transaction; the page
   must have loaded once (it creates the database). req(r) turns an IDBRequest into a promise */
export const inDb = (fn, mode = "readwrite") => `(async () => {
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const db = await req(indexedDB.open("ntab"));
  const t = db.transaction([...db.objectStoreNames], ${JSON.stringify(mode)});
  const s = Object.fromEntries([...db.objectStoreNames].map((n) => [n, t.objectStore(n)]));
  const out = await (${fn})(s, req);
  await new Promise((ok) => (t.oncomplete = ok));
  db.close();
  return out;
})()`;

/* expression: the records of a store */
export const dbAll = (store) => inDb(`async (s, req) => req(s.${store}.getAll())`, "readonly");

/* action records for [{ name, url, newTab? }] */
export const actionList = (list) =>
  list.map(({ name, url, newTab = false }, rank) => ({ id: `a${rank}`, name, icon: null, rank, kind: "open", options: { url, newTab } }));

/* expression that empties every store and sets the actions (default: Notes, Tracker, Board); reload afterwards */
export const resetData = (actions = [{ name: "Notes", url: "#/notes" }, { name: "Tracker", url: "#/tracker" }, { name: "Board", url: "#/board" }]) =>
  inDb(`async (s) => {
    for (const store of Object.values(s)) store.clear();
    for (const a of ${JSON.stringify(actionList(actions))}) s.actions.put(a);
    s.meta.put({ lastExportAt: null, remindAt: Date.now() + 864e6 }, "backup");
  }`);

/* opens an app from the sidebar */
export async function openApp(P, id) {
  await P.ev(`document.querySelector('#links .${id}').click()`);
  await sleep(500);
}
