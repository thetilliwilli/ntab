/* actions editor (✎ in the sidebar): form mode and raw JSON mode (like VS Code settings) */

import { getActions, iconEl, saveActions, newAction, appOf, isRoute } from "./actions.js";
import { pickFile, iconFromFile } from "./icon-file.js";
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

function normalize(a) {
  if (a.kind !== "open") return a; // a kind of a newer version: kept as it is
  const url = fixUrl(String(a.options?.url ?? "").trim());
  return { ...a, name: String(a.name ?? "").trim(), options: { url, newTab: !!a.options?.newTab } };
}

/* drops untouched empty rows, normalizes the rest */
const cleanList = (list) => list.filter((a) => a.kind !== "open" || String(a.name ?? "").trim() || String(a.options?.url ?? "").trim()).map(normalize);

/* what is wrong with an action, or "" */
function problem(a) {
  if (a.kind !== "open") return getActions().some((x) => x.id === a.id && x.kind === a.kind) ? "" : `"kind" can only be "open"`;
  if (!a.name) return "a name is required";
  const route = routeOf(a.options.url);
  if (route != null) return appById(route) ? "" : `"${a.options.url}" is not an app; apps: ${apps.map((x) => `#/${x.id}`).join(", ")}`;
  return hostOf(a.options.url) ? "" : "a valid URL is required";
}

function parseJson() {
  try {
    const data = JSON.parse(jsonText.value);
    if (!Array.isArray(data)) throw new Error("top level must be an array");
    const known = new Map(draft.map((a) => [a.id, a]));
    const list = data.map((a, i) => {
      if (!a || typeof a !== "object") throw new Error(`item ${i + 1}: must be an object`);
      if (typeof a.name !== "string") throw new Error(`item ${i + 1}: "name" must be a string`);
      if (a.kind === "open" && typeof a.options?.url !== "string") throw new Error(`item ${i + 1}: "options.url" must be a string`);
      const was = known.get(a.id);
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
  if (a.kind !== "open") {
    r.append(el("span", "sc-what", `“${a.kind}” action from a newer version: kept, not shown`), el("span"), el("span"), del);
    return r;
  }

  const url = el("input", "url");
  url.type = "text";
  url.placeholder = "https://…  or  #/notes";
  url.setAttribute("aria-label", "Address");
  url.value = a.options.url;
  url.spellcheck = false;

  const check = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = !!a.options.newTab;
  check.title = "Open in a new browser tab";
  check.append(box, "new tab");
  box.addEventListener("change", () => (a.options.newTab = box.checked));
  const syncCheck = () => (check.style.visibility = isRoute(normalize(a)) ? "hidden" : "");
  syncCheck();

  url.addEventListener("input", () => {
    a.options.url = url.value;
    syncCheck();
  });
  url.addEventListener("change", refreshIcon);

  const uploadBtn = el("button", "", "⤒");
  uploadBtn.title = "Upload your own icon";
  uploadBtn.addEventListener("click", async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      a.icon = await iconFromFile(file);
      refreshIcon();
      msg("icon set — Save to apply", "ok");
    } catch {
      msg(`${file.name}: not an image the browser can read`, "err");
    }
  });
  const resetBtn = el("button", "", "↺");
  resetBtn.title = "Back to the automatic icon";
  resetBtn.addEventListener("click", () => {
    a.icon = null;
    refreshIcon();
  });

  r.append(url, check, uploadBtn, resetBtn, del);
  return r;
}
