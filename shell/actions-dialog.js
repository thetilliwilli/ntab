/* actions editor (✎ in the sidebar): form mode and raw JSON mode (like VS Code settings) */

import { getLinks, getIconMap, iconEl } from "./actions.js";
import { pickFile, iconFromFile } from "./icon-file.js";
import { saveLinks, setIcons } from "../shared/settings.js";
import { apps, appById } from "./apps.js";
import { $, el, hostOf, fixUrl, isApp, iconKey, sortable } from "../shared/util.js";

const isNotes = (action) => action.type === "notes";
const newApp = (app) => ({ type: app.id, name: app.name });

const dlg = $("sc");
const rows = $("sc-rows");
const jsonText = $("sc-json-text");
const jsonErr = $("sc-json-err");

let draft = []; // [{ name, url, target? } | { type: <app id>, name }] being edited
let pendingIcons = {}; // icon key -> dataURL, or null = reset
let mode = "form";

export function initActionsDialog() {
  $("links-edit").addEventListener("click", openDialog);
  $("sc-mode-form").addEventListener("click", () => setMode("form"));
  $("sc-mode-json").addEventListener("click", () => setMode("json"));
  $("sc-add").addEventListener("click", () => addRow({ name: "", url: "" }, false));
  $("sc-notes-back").addEventListener("click", () => addRow(newApp(appById("notes")), true));
  // "+ notepad", "+ tracker"…: one button per app, shown while the app isn't in the list
  for (const app of apps) {
    const b = el("button", "add", `+ ${app.what}`);
    b.dataset.app = app.id;
    b.addEventListener("click", () => addRow(newApp(app), false));
    $("sc-adds").append(b);
  }
  $("sc-app-ids").textContent = apps.map((a) => `"${a.id}"`).join(", ");
  $("sc-save").addEventListener("click", save);
  $("sc-cancel").addEventListener("click", () => dlg.close());
  $("sc-x").addEventListener("click", () => dlg.close());
}

function openDialog() {
  draft = structuredClone(getLinks());
  pendingIcons = {};
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
    jsonText.value = JSON.stringify(cleanList(draft), null, 2);
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

function normalize(l) {
  const name = String(l.name ?? "").trim();
  if (isApp(l)) return { type: l.type, name: name || appById(l.type)?.name || l.type };
  const out = { name, url: fixUrl(String(l.url ?? "").trim()) };
  if (l.target) out.target = String(l.target);
  return out;
}

/* drops untouched empty link rows, normalizes the rest */
const cleanList = (list) => list.filter((l) => isApp(l) || String(l.name ?? "").trim() || String(l.url ?? "").trim()).map(normalize);

function parseJson() {
  try {
    const data = JSON.parse(jsonText.value);
    if (!Array.isArray(data)) throw new Error("top level must be an array");
    data.forEach((l, i) => {
      if (!l || typeof l !== "object") throw new Error(`item ${i + 1}: must be an object`);
      // apps of this version, and of a newer one that were in the list already (synced from another machine)
      if (l.type != null && !appById(l.type) && !getLinks().some((x) => x.type === l.type))
        throw new Error(`item ${i + 1}: "type" can only be ${apps.map((a) => `"${a.id}"`).join(", ")} (or left out for a link)`);
      if (typeof l.name !== "string") throw new Error(`item ${i + 1}: "name" must be a string`);
      if (isApp(l)) return;
      if (typeof l.url !== "string") throw new Error(`item ${i + 1}: "url" must be a string`);
      if (l.target != null && typeof l.target !== "string") throw new Error(`item ${i + 1}: "target" must be a string`);
    });
    jsonErr.textContent = "";
    return data.map(normalize);
  } catch (e) {
    jsonErr.textContent = e.message;
    return null;
  }
}

function mergedIcons() {
  const out = { ...getIconMap(), ...pendingIcons };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

async function save() {
  const list = mode === "json" ? parseJson() : cleanList(draft);
  if (!list) return;
  const bad = list.findIndex((l) => !isApp(l) && (!l.name || !hostOf(l.url)));
  if (bad !== -1) return msg(`item ${bad + 1}: name and a valid URL are required`, "err");
  if (!list.some(isNotes) && !confirm("The notepad isn't in the list, so there will be no way to open your notes.\nSave anyway?")) return;
  try {
    await saveLinks(list);
    if (Object.keys(pendingIcons).length) await setIcons(mergedIcons());
    dlg.close();
  } catch (e) {
    msg(e.message, "err");
  }
}

/* ---------- form rows ---------- */

function renderRows() {
  rows.textContent = "";
  draft.forEach((link, i) => rows.append(row(link, i)));
  $("sc-nonotes").hidden = draft.some(isNotes);
  for (const b of $("sc-adds").querySelectorAll("[data-app]")) b.hidden = draft.some((l) => l.type === b.dataset.app);
}

function row(link, i) {
  const r = el("div", "sc-row");
  const handle = el("span", "drag-handle", "⋮⋮");
  handle.title = "Drag to reorder";

  const type = el("select");
  type.setAttribute("aria-label", "Action type");
  type.append(new Option("link", "link"), ...apps.map((a) => new Option(a.what, a.id)));
  if (isApp(link) && !appById(link.type)) type.append(new Option(`${link.type} (unknown)`, link.type)); // from a newer version
  type.value = isApp(link) ? link.type : "link";
  type.addEventListener("change", () => {
    const app = appById(type.value);
    if (app) {
      // a name that was empty or the previous app's default follows the new app
      if (!link.name.trim() || link.name === appById(link.type)?.name) link.name = app.name;
      link.type = app.id;
      delete link.url;
      delete link.target;
    } else {
      delete link.type;
      link.url = "";
    }
    renderRows();
  });

  const name = el("input");
  name.type = "text";
  name.placeholder = "Name";
  name.setAttribute("aria-label", "Action name");
  name.value = link.name;

  const uploadBtn = el("button", "", "⤒");
  uploadBtn.title = "Upload your own icon";
  const resetBtn = el("button", "", "↺");
  resetBtn.title = "Reset icon";
  const del = el("button", "del", "×");
  del.title = "Remove";

  const refreshIcon = () => r.querySelector(".ico").replaceWith(iconEl(normalize(link), mergedIcons()));

  name.addEventListener("input", () => (link.name = name.value));
  name.addEventListener("change", refreshIcon);
  uploadBtn.addEventListener("click", () => uploadFor(link, refreshIcon));
  resetBtn.addEventListener("click", () => {
    const key = iconKey(normalize(link));
    if (!key) return;
    pendingIcons[key] = null;
    refreshIcon();
    msg(`icon for ${key} reset — Save to apply`);
  });
  del.addEventListener("click", () => {
    draft.splice(i, 1);
    renderRows();
  });

  // drag only from the handle so the inputs stay selectable
  handle.addEventListener("mousedown", () => (r.draggable = true));
  sortable(r, {
    group: "shortcuts",
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

  r.append(handle, iconEl(normalize(link), mergedIcons()), type, name);
  if (isApp(link)) {
    r.append(el("span", "sc-what", `opens the ${appById(link.type)?.what ?? "app"}`));
  } else {
    const url = el("input", "url");
    url.type = "text";
    url.placeholder = "https://…";
    url.setAttribute("aria-label", "Link URL");
    url.value = link.url;
    url.spellcheck = false;
    url.addEventListener("input", () => (link.url = url.value));
    url.addEventListener("change", refreshIcon);

    const check = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = !!link.target;
    check.title = 'Open in a new browser tab (target="_blank")';
    check.append(box, "new tab");
    box.addEventListener("change", () => {
      if (box.checked) link.target = "_blank";
      else delete link.target;
    });
    r.append(url, check);
  }
  r.append(uploadBtn, resetBtn, del);
  return r;
}

async function uploadFor(link, refreshIcon) {
  const key = iconKey(normalize(link));
  if (!key) return msg("enter a valid URL first", "err");
  const file = await pickFile();
  if (!file) return;
  try {
    pendingIcons[key] = await iconFromFile(file);
    refreshIcon();
    msg(`icon for ${key} set — Save to apply`, "ok");
  } catch {
    msg(`${file.name}: not an image the browser can read`, "err");
  }
}
