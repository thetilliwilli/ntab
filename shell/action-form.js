/* the action form (#add): one action of any kind. the "+" tile on home adds one; the actions editor edits a row
   with it (⚙). kind-specific fields carry data-for="<kind>" and show only for that kind */

import { iconEl, addAction, saveAction, removeAction, newAction, optionsFor, appOf, METHODS, DEFAULT_RENDER } from "./actions.js";
import { showMenu } from "../shared/menu.js";
import { pickFile, iconFromFile } from "./icon-file.js";
import { appById } from "./apps.js";
import { $, hostOf, fixUrl, routeOf } from "../shared/util.js";

const dlg = $("add");
const url = $("add-url");
const name = $("add-name");
let kind = "open";
let icon = null; // uploaded icon, data URL
let base = null; // the action being edited (keeps id and rank), null = a new one
let done = null; // called with the finished action

/* default name from the URL: "https://www.github.com/x" -> "github.com", "#/notes" -> "Notes" */
const nameFromUrl = (u) => appById(routeOf(u))?.name ?? (hostOf(fixUrl(u)) || "").replace(/^www\./, "");

/* "Name: value" lines <-> { name: value } */
const headersText = (h) => Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
function parseHeaders(text) {
  const out = {};
  for (const [i, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 1) throw new Error(`headers, line ${i + 1}: expected "Name: value"`);
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/* the action as the form shows it; throws on bad headers */
function action() {
  const u = url.value.trim() && fixUrl(url.value.trim());
  const options = optionsFor(kind, u);
  if (kind === "open") options.newTab = $("add-blank").checked;
  else Object.assign(options, { method: $("add-method").value, headers: parseHeaders($("add-headers").value), body: $("add-body").value,
      render: $("add-render").value.trim() || DEFAULT_RENDER });
  return { ...(base ?? newAction()), name: name.value.trim() || nameFromUrl(url.value.trim()), icon, kind, options };
}

/* what is wrong with the form's URL, or "" */
function urlProblem(a) {
  const route = routeOf(a.options.url);
  if (kind === "open" && route != null) return appById(route) ? "" : `"${a.options.url}" is not an app`;
  if (kind === "request" && !/^https?:/i.test(a.options.url)) return "a request needs an http:// or https:// URL";
  return hostOf(a.options.url) ? "" : "enter a valid URL";
}

function msg(text, k = "") {
  $("add-msg").textContent = text;
  $("add-msg").className = `msg ${k}`;
}

function setKind(k) {
  kind = k;
  for (const b of $("add-kind").children) b.classList.toggle("on", b.dataset.kind === k);
  for (const n of dlg.querySelectorAll("[data-for]")) n.hidden = n.dataset.for !== k;
  url.placeholder = k === "open" ? "https://…  or  #/notes" : "https://api.example.com/…";
  refreshIcon();
}

function refreshIcon() {
  let a;
  try {
    a = action();
  } catch {
    return;
  }
  const ico = iconEl({ ...a, name: a.name || "?" });
  ico.id = "add-ico";
  $("add-ico").replaceWith(ico);
  name.placeholder = nameFromUrl(url.value.trim()) || "Name";
  $("add-reset").hidden = !icon;
  $("add-ico-note").textContent = icon ? "your upload" : appOf(a) ? "the app's icon" : hostOf(a.options.url) ? "from Chrome's cache of the site" : "";
}

/* opens the form for `edit` (an action) or a new action; onDone(action) gets the result */
export function openActionForm({ edit = null, onDone }) {
  base = edit;
  done = onDone;
  const o = edit?.options ?? {};
  url.value = o.url ?? "";
  name.value = edit?.name ?? "";
  icon = edit?.icon ?? null;
  $("add-blank").checked = !!o.newTab;
  $("add-method").value = o.method ?? "GET";
  $("add-headers").value = headersText(o.headers);
  $("add-body").value = o.body ?? "";
  $("add-render").value = o.render ?? DEFAULT_RENDER;
  $("add-title").textContent = edit ? "Edit action" : "Add action";
  $("add-save").textContent = edit ? "Done" : "Add";
  msg("");
  setKind(edit?.kind ?? "open");
  dlg.showModal();
  url.focus();
}

export const openAddDialog = () => openActionForm({ onDone: addAction });

/* right-click on a tile or a sidebar icon: edit it in the form, or delete it (picking it is the confirmation) */
export function actionMenu(e, action) {
  showMenu(e, [
    { label: "Edit", run: () => openActionForm({ edit: structuredClone(action), onDone: saveAction }) },
    { label: "Delete", danger: true, run: () => removeAction(action.id).catch(console.error) },
  ]);
}

export function initActionForm() {
  for (const [k, label] of [["open", "Open a page or app"], ["request", "Send a request"]]) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    b.dataset.kind = k;
    b.addEventListener("click", () => setKind(k));
    $("add-kind").append(b);
  }
  for (const m of METHODS) $("add-method").append(new Option(m, m));
  url.addEventListener("input", () => (name.placeholder = nameFromUrl(url.value.trim()) || "Name"));
  url.addEventListener("change", refreshIcon);
  name.addEventListener("change", refreshIcon);
  $("add-x").addEventListener("click", () => dlg.close());
  $("add-cancel").addEventListener("click", () => dlg.close());
  $("add-reset").addEventListener("click", () => {
    icon = null;
    refreshIcon();
  });
  $("add-upload").addEventListener("click", async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      icon = await iconFromFile(file);
      msg("");
    } catch {
      msg(`${file.name}: not an image the browser can read`, "err");
    }
    refreshIcon();
  });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let a;
    try {
      a = action();
    } catch (err) {
      return msg(err.message, "err");
    }
    const problem = urlProblem(a);
    if (problem) {
      msg(problem, "err");
      return url.focus();
    }
    try {
      await done(a);
      dlg.close();
    } catch (err) {
      msg(err.message, "err");
    }
  });
}
