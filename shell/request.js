/* "request" actions: sends the request and shows the response in a dialog (#req): status, time, type, size, and two
   tabs: "render" (default) shows what the action's render function makes of the body, "raw" the headers (folded)
   and the body as text (JSON pretty-printed). binary responses aren't shown, only described.
   the render function is code the user typed: MV3 lets only a sandboxed page evaluate it, so it runs in the
   iframe shell/render.html (no chrome.*, no access to our data); its messages are only data to us.
   without a host permission the browser applies CORS; when a request fails that way the dialog offers to allow
   the site (an optional host permission, see platform/) and sends it again */

import * as platform from "../platform/index.js";
import { $, fmtSize } from "../shared/util.js";
import { DEFAULT_RENDER } from "./actions.js";

const TIMEOUT = 30_000;
const MAX_SHOWN = 1 << 20; // longer bodies are cut in the dialog (Copy takes it all)
const TEXT = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|csv|yaml|toml|graphql/i;

const dlg = $("req");
let current = null; // the action shown
let ctrl = null; // AbortController of the request in flight
let fullBody = "";
let canAllow = false; // the last failure may be CORS on a site without host access
let tab = "render";
let rendered = ""; // the text of what the render frame shows (for Copy)
let renderId = 0; // the latest render job; older answers are ignored
let frameReady = false;
let pending = null; // a render job sent before the frame was loaded
let renderTimer = 0;

const frame = () => $("req-frame");

function setTab(t) {
  tab = t;
  for (const b of $("req-tabs").children) b.classList.toggle("on", b.dataset.tab === t);
  $("req-pane-render").hidden = t !== "render";
  $("req-pane-raw").hidden = t !== "raw";
  copyButton();
}

const copyText = () => (tab === "render" ? rendered : fullBody);
const copyButton = () => ($("req-copy").hidden = !!ctrl || !copyText());

/* shows `text` through the action's render function in the frame; null clears it */
function render(text) {
  rendered = "";
  const id = ++renderId;
  clearTimeout(renderTimer);
  const css = getComputedStyle(document.body);
  const job = {
    id,
    code: text == null ? "() => ''" : current.options.render || DEFAULT_RENDER,
    text: text ?? "",
    style: { color: css.color, background: css.getPropertyValue("--surface"), font: `13px/1.5 ${css.getPropertyValue("--ui")}` },
  };
  if (frameReady) frame().contentWindow.postMessage(job, "*");
  else pending = job;
  if (text != null)
    renderTimer = setTimeout(() => id === renderId && ($("req-note").textContent = "render is still running (a loop in the function?)"), 5000);
}

function onFrameMessage(e) {
  if (e.source !== frame().contentWindow || !e.data || typeof e.data !== "object") return;
  const { ready, height, id, ok, text, error } = e.data;
  if (ready) {
    frameReady = true;
    if (pending) frame().contentWindow.postMessage(pending, "*");
    pending = null;
  } else if (typeof height === "number") frame().style.height = `${Math.max(40, Math.min(height, 1e5))}px`;
  else if (id === renderId) {
    clearTimeout(renderTimer);
    rendered = ok ? String(text ?? "") : "";
    if (!ok && current) $("req-note").textContent = `render failed: ${String(error).slice(0, 200)}`;
    copyButton();
  }
}

function set({ status = "", kind = "", meta = "", headers = "", body = "", note = "" }) {
  $("req-status").textContent = status;
  $("req-status").className = `req-status ${kind}`;
  $("req-meta").textContent = meta;
  $("req-headers").hidden = !headers;
  $("req-head-text").textContent = headers;
  $("req-body").textContent = body;
  $("req-body").hidden = !body;
  $("req-note").textContent = note;
}

function busy(on) {
  if (on) canAllow = false;
  $("req-cancel").hidden = !on;
  $("req-repeat").hidden = on;
  $("req-copy").hidden = on || !copyText();
  $("req-allow").hidden = on || !canAllow;
}

/* JSON pretty-printed, anything else as it came */
function pretty(text, type) {
  if (!/json/i.test(type) && !/^\s*[[{]/.test(text)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function send() {
  const { url, method, headers, body } = current.options;
  fullBody = "";
  render(null);
  busy(true);
  set({ status: `${method} …`, meta: url });
  ctrl = new AbortController();
  const mine = ctrl;
  const timer = setTimeout(() => mine.abort(new DOMException("timeout", "TimeoutError")), TIMEOUT);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" || !body ? undefined : body,
      signal: mine.signal,
      cache: "no-store",
    });
    const type = res.headers.get("content-type") || "";
    let text = "";
    let size = 0;
    if (!type || TEXT.test(type)) {
      text = await res.text();
      size = new Blob([text]).size;
    } else size = (await res.arrayBuffer()).byteLength;
    if (mine !== ctrl) return; // cancelled or sent again meanwhile
    const ms = Math.round(performance.now() - t0);
    fullBody = pretty(text, type);
    const cut = fullBody.length > MAX_SHOWN;
    set({
      status: `${res.status} ${res.statusText}`.trim(),
      kind: res.ok ? "ok" : "err",
      meta: `${ms} ms · ${type.split(";")[0] || "no content type"} · ${fmtSize(size)}`,
      headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n"),
      body: cut ? fullBody.slice(0, MAX_SHOWN) : fullBody,
      note: cut
        ? `showing the first ${fmtSize(MAX_SHOWN)}; Copy takes all of it`
        : text || method === "HEAD" ? "" : size ? `binary response (${type}), not shown` : "empty response",
    });
    if (text) render(text); // the body as it came, not pretty-printed
  } catch (e) {
    if (mine !== ctrl) return;
    const reason = mine.signal.reason;
    if (reason?.name === "TimeoutError") set({ status: "timed out", kind: "err", meta: `no answer in ${TIMEOUT / 1000} s` });
    else if (e.name === "AbortError") set({ status: "cancelled", kind: "err" });
    else await failed(e);
  } finally {
    clearTimeout(timer);
    if (mine === ctrl) {
      ctrl = null;
      busy(false);
    }
  }
}

/* a network error: the server is unreachable, or CORS blocked the answer; the second one an allowed site fixes */
async function failed(e) {
  const host = new URL(current.options.url).host;
  const allowed = await platform.hasHostAccess(current.options.url);
  canAllow = !allowed;
  $("req-allow").textContent = `Allow access to ${host}`;
  set({
    status: "request failed",
    kind: "err",
    meta: e.message,
    note: allowed
      ? `${host} could not be reached.`
      : `${host} could not be reached, or it doesn't allow requests from other sites (CORS). ` +
        `If the site is up, allow NTab to access it: the browser asks once for this site only.`,
  });
}

export function runRequest(action) {
  current = action;
  if (!dlg.open) setTab("render");
  $("req-title").textContent = `${action.name} · ${action.options.method} ${action.options.url}`;
  if (!dlg.open) dlg.showModal();
  send();
}

export function initRequestDialog() {
  const stop = () => {
    const c = ctrl;
    ctrl = null;
    c?.abort();
  };
  $("req-x").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", stop);
  $("req-cancel").addEventListener("click", () => ctrl?.abort());
  $("req-repeat").addEventListener("click", () => runRequest(current));
  for (const b of $("req-tabs").children) b.addEventListener("click", () => setTab(b.dataset.tab));
  setTab("render");
  addEventListener("message", onFrameMessage);
  $("req-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(copyText());
    $("req-note").textContent = "copied";
  });
  $("req-allow").addEventListener("click", async () => {
    let granted;
    try {
      granted = await platform.requestHostAccess(current.options.url);
    } catch (e) {
      // the browser didn't even ask: say why (e.g. the extension was not reloaded after an update of its manifest)
      return ($("req-note").textContent = `the browser refused to ask for access: ${e?.message || e}`);
    }
    if (granted) runRequest(current);
    else $("req-note").textContent = "access was not granted (declined in the browser's prompt)";
  });
}
