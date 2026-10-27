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
export const newPage = async () => connect((await (await fetch(`${CDP}/json/new?${PAGE}`, { method: "PUT" })).json()).webSocketDebuggerUrl);

export const ok = (label, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", label, extra);

/* OPFS "notes" folder = the notes folder the stub's showDirectoryPicker returns */
export const notesDir = `(await (await navigator.storage.getDirectory()).getDirectoryHandle('notes', { create: true }))`;
