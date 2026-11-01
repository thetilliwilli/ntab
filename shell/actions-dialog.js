/* actions editor (✎ in the sidebar): form mode and raw JSON mode (like VS Code settings) */

import { getActions, iconEl, saveActions, newAction, appOf, isRoute, KINDS, METHODS, optionsFor } from "./actions.js";
import { openActionForm } from "./action-form.js";
import { apps, appById } from "./apps.js";
import { $, el, hostOf, fixUrl, routeOf, sortable } from "../shared/util.js";

const opensNotes = (a) => a.kind === "open" && routeOf(a.options?.url) === "notes";
const appAction = (app) => newAction(app.name, `#/${app.id}`);

const dlg = $("sc");
const rows = $("sc-rows");
const jsonText = $("sc-json-text");
const jsonErr = $("sc-json-err");

let draft = []; // actions being edited
let mode = "form";

export function initActionsDialog() {
  $("links-edit").addEventListener("click", openDialog);
  $("sc-mode-form").addEventListener("click", () => setMode("form"));
  $("sc-mode-json").addEventListener("click", () => setMode("json"));
  $("sc-add").addEventListener("click", () => addRow(newAction("", ""), false));
  $("sc-add-request").addEventListener("click", () =>
    openActionForm({ edit: { ...newAction("", ""), kind: "request", options: optionsFor("request") }, onDone: (a) => addRow(a, false) }),
  );
  $("sc-notes-back").addEventListener("click", () => addRow(appAction(appById("notes")), true));
  // "+ notepad", "+ tracker"…: one button per app, shown while no action opens it
  for (const app of apps) {
    const b = el("button", "add", `+ ${app.what}`);
    b.dataset.app = app.id;
    b.addEventListener("click", () => addRow(appAction(app), false));
    $("sc-adds").append(b);
  }
  $("sc-routes").textContent = apps.map((a) => `"#/${a.id}"`).join(", ");
  $("sc-save").addEventListener("click", save);
  $("sc-cancel").addEventListener("click", () => dlg.close());
  $("sc-x").addEventListener("click", () => dlg.close());
}

function openDialog() {
  draft = structuredClone(getActions());
  setMode("form", true);
  msg("");
  dlg.showModal();
}

function addRow(action, first) {
  if (first) draft.unshift(action);
  else draft.push(action);
  renderRows();
  (first ? rows.firstElementChild : rows.lastElementChild)?.querySelector("input")?.focus();
}

function msg(text, kind = "") {
  const m = $("sc-msg");
  m.textContent = text;
  m.className = `msg ${kind}`;
}

function setMode(m, force = false) {
  if (m === mode && !force) return;
  if (m === "form" && mode === "json" && !force) {
    const parsed = parseJson();
    if (!parsed) return;
    draft = parsed;
  }
  if (m === "json") {
    // icons are images, not something to edit as text: they stay with the action's id
    jsonText.value = JSON.stringify(cleanList(draft).map(({ id, name, kind, options }) => ({ id, name, kind, options })), null, 2);
    jsonErr.textContent = "";
  }
  mode = m;
  $("sc-form").hidden = m !== "form";
  $("sc-json").hidden = m !== "json";
  $("sc-mode-form").classList.toggle("on", m === "form");
  $("sc-mode-json").classList.toggle("on", m === "json");
  if (m === "form") renderRows();
  else jsonText.focus();
}

/* ---------- data ---------- */

const known = (a) => a.kind in KINDS;

function normalize(a) {
  if (!known(a)) return a; // a kind of a newer version: kept as it is
  const o = a.options ?? {};
  const url = fixUrl(String(o.url ?? "").trim());
  const options =
    a.kind === "open"
      ? { url, newTab: !!o.newTab }
      : {
          url,
          method: String(o.method || "GET").toUpperCase(),
          headers: Object.fromEntries(Object.entries(o.headers && typeof o.headers === "object" ? o.headers : {}).map(([k, v]) => [k, String(v)])),
          body: String(o.body ?? ""),
        };
  return { ...a, name: String(a.name ?? "").trim(), options };
}

/* drops untouched empty rows, normalizes the rest */
const cleanList = (list) => list.filter((a) => !known(a) || String(a.name ?? "").trim() || String(a.options?.url ?? "").trim()).map(normalize);

/* what is wrong with an action, or "" */
function problem(a) {
  if (!known(a)) return getActions().some((x) => x.id === a.id && x.kind === a.kind) ? "" : `"kind" can only be ${Object.keys(KINDS).map((k) => `"${k}"`).join(" or ")}`;
  if (!a.name) return "a name is required";
  if (a.kind === "request") {
    if (!METHODS.includes(a.options.method)) return `"method" can only be ${METHODS.join(", ")}`;
    return /^https?:/i.test(a.options.url) && hostOf(a.options.url) ? "" : "a request needs an http:// or https:// URL";
  }
  const route = routeOf(a.options.url);
  if (route != null) return appById(route) ? "" : `"${a.options.url}" is not an app; apps: ${apps.map((x) => `#/${x.id}`).join(", ")}`;
  return hostOf(a.options.url) ? "" : "a valid URL is required";
}

function parseJson() {
  try {
    const data = JSON.parse(jsonText.value);
    if (!Array.isArray(data)) throw new Error("top level must be an array");
    const before = new Map(draft.map((a) => [a.id, a]));
    const list = data.map((a, i) => {
      if (!a || typeof a !== "object") throw new Error(`item ${i + 1}: must be an object`);
      if (typeof a.name !== "string") throw new Error(`item ${i + 1}: "name" must be a string`);
      if (known(a) && typeof a.options?.url !== "string") throw new Error(`item ${i + 1}: "options.url" must be a string`);
      if (a.kind === "request" && a.options.headers != null && (typeof a.options.headers !== "object" || Array.isArray(a.options.headers)))
        throw new Error(`item ${i + 1}: "options.headers" must be an object { "Name": "value" }`);
      const was = before.get(a.id);
      return normalize({ ...newAction("", ""), icon: was?.icon ?? null, ...a, id: was ? a.id : newAction().id });
    });
    const bad = list.findIndex((a) => problem(a));
    if (bad !== -1) throw new Error(`item ${bad + 1}: ${problem(list[bad])}`);
    jsonErr.textContent = "";
    return list;
  } catch (e) {
    jsonErr.textContent = e.message;
    return null;
  }
}

async function save() {
  const list = mode === "json" ? parseJson() : cleanList(draft);
  if (!list) return;
  const bad = list.findIndex((a) => problem(a));
  if (bad !== -1) return msg(`item ${bad + 1}: ${problem(list[bad])}`, "err");
  if (!list.some(opensNotes) && !confirm("No action opens the notepad, so there will be no way to open your notes.\nSave anyway?")) return;
  try {
    await saveActions(list);
    dlg.close();
  } catch (e) {
    msg(e.message, "err");
  }
}

/* ---------- form rows ---------- */

function renderRows() {
  rows.textContent = "";
  draft.forEach((a, i) => rows.append(row(a, i)));
  $("sc-nonotes").hidden = draft.some(opensNotes);
  for (const b of $("sc-adds").querySelectorAll("[data-app]")) b.hidden = draft.some((a) => appOf(normalize(a))?.id === b.dataset.app);
}

function row(a, i) {
  const r = el("div", "sc-row");
  const handle = el("span", "drag-handle", "⋮⋮");
  handle.title = "Drag to reorder";

  const name = el("input");
  name.type = "text";
  name.placeholder = "Name";
  name.setAttribute("aria-label", "Action name");
  name.value = a.name;

  const del = el("button", "del", "×");
  del.title = "Remove";
  del.addEventListener("click", () => {
    draft.splice(i, 1);
    renderRows();
  });

  const refreshIcon = () => r.querySelector(".ico").replaceWith(iconEl(normalize({ ...a, name: a.name || "?" })));
  name.addEventListener("input", () => (a.name = name.value));
  name.addEventListener("change", refreshIcon);

  // drag only from the handle so the inputs stay selectable
  handle.addEventListener("mousedown", () => (r.draggable = true));
  sortable(r, {
    group: "actions",
    key: i,
    vertical: true,
    onDrop(from, to, after) {
      const [moved] = draft.splice(from, 1);
      let at = to + (after ? 1 : 0);
      if (from < at) at--;
      draft.splice(at, 0, moved);
      renderRows();
    },
    onEnd: () => (r.draggable = false),
  });

  r.append(handle, iconEl(normalize({ ...a, name: a.name || "?" })), name);
  if (!known(a)) {
    r.append(el("span", "sc-what", `“${a.kind}” action from a newer version: kept, not shown`), el("span"), del);
    return r;
  }

  // everything about the action, icon included, in the action form
  const more = el("button", "sc-more", "⚙");
  more.title = "Edit all of it: kind, icon, request headers and body";
  more.addEventListener("click", () =>
    openActionForm({
      edit: normalize(structuredClone(a)),
      onDone: (next) => {
        draft[i] = next;
        renderRows();
      },
    }),
  );

  const url = el("input", "url");
  url.type = "text";
  url.placeholder = a.kind === "open" ? "https://…  or  #/notes" : "https://api.example.com/…";
  url.setAttribute("aria-label", "Address");
  url.value = a.options.url;
  url.spellcheck = false;

  let extra;
  if (a.kind === "request") {
    extra = el("button", "sc-method", a.options.method);
    extra.title = "A request: method, headers and body are in ⚙";
    extra.addEventListener("click", () => more.click());
  } else {
    extra = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = !!a.options.newTab;
    extra.title = "Open in a new browser tab";
    extra.append(box, "new tab");
    box.addEventListener("change", () => (a.options.newTab = box.checked));
  }
  const syncExtra = () => (extra.style.visibility = isRoute(normalize(a)) ? "hidden" : "");
  syncExtra();

  url.addEventListener("input", () => {
    a.options.url = url.value;
    syncExtra();
  });
  url.addEventListener("change", refreshIcon);

  r.append(url, extra, more, del);
  return r;
}
