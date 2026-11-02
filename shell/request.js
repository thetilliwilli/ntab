/* "request" actions: sends the request and shows the response in a dialog (#req): status, time, type, size, the
   headers (folded) and the body as text (JSON pretty-printed). binary responses aren't shown, only described.
   without a host permission the browser applies CORS; when a request fails that way the dialog offers to allow
   the site (an optional host permission, see platform/) and sends it again */

import * as platform from "../platform/index.js";
import { $, fmtSize } from "../shared/util.js";

const TIMEOUT = 30_000;
const MAX_SHOWN = 1 << 20; // longer bodies are cut in the dialog (Copy takes it all)
const TEXT = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|csv|yaml|toml|graphql/i;

const dlg = $("req");
let current = null; // the action shown
let ctrl = null; // AbortController of the request in flight
let fullBody = "";
let canAllow = false; // the last failure may be CORS on a site without host access

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
  $("req-copy").hidden = on || !fullBody;
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
  $("req-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(fullBody);
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
