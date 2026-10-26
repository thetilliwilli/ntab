/* shortcuts editor: form mode and raw JSON mode (like VS Code settings) */

import { getLinks, getIconMap, iconEl, loadImg } from "./sidebar.js";
import { saveLinks, setIcons } from "./settings.js";
import { $, el, hostOf } from "./util.js";

const dlg = $("sc");
const rows = $("sc-rows");
const jsonText = $("sc-json-text");
const jsonErr = $("sc-json-err");

let draft = []; // [{ name, url, target? }] being edited
let pendingIcons = {}; // hostname -> dataURL, or null = reset
let mode = "form";
let dragIndex = -1;

export function initShortcutsDialog() {
  $("links-edit").addEventListener("click", openDialog);
  $("sc-mode-form").addEventListener("click", () => setMode("form"));
  $("sc-mode-json").addEventListener("click", () => setMode("json"));
  $("sc-add").addEventListener("click", () => {
    draft.push({ name: "", url: "" });
    renderRows();
    rows.lastElementChild?.querySelector("input")?.focus();
  });
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

const fixUrl = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);

function normalize(l) {
  const out = { name: String(l.name ?? "").trim(), url: fixUrl(String(l.url ?? "").trim()) };
  if (l.target) out.target = String(l.target);
  return out;
}

/* drops untouched empty rows, normalizes the rest */
const cleanList = (list) => list.filter((l) => String(l.name ?? "").trim() || String(l.url ?? "").trim()).map(normalize);

function parseJson() {
  try {
    const data = JSON.parse(jsonText.value);
    if (!Array.isArray(data)) throw new Error("top level must be an array");
    data.forEach((l, i) => {
      if (!l || typeof l !== "object") throw new Error(`item ${i + 1}: must be an object`);
      if (typeof l.name !== "string" || typeof l.url !== "string") throw new Error(`item ${i + 1}: "name" and "url" must be strings`);
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
  const bad = list.findIndex((l) => !l.name || !hostOf(l.url));
  if (bad !== -1) return msg(`shortcut ${bad + 1}: name and a valid URL are required`, "err");
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
}

function row(link, i) {
  const r = el("div", "sc-row");
  const handle = el("span", "sc-handle", "⋮⋮");
  handle.title = "Drag to reorder";

  const name = el("input");
  name.type = "text";
  name.placeholder = "Name";
  name.value = link.name;

  const url = el("input", "url");
  url.type = "text";
  url.placeholder = "https://…";
  url.value = link.url;
  url.spellcheck = false;

  const check = el("label", "sc-check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = !!link.target;
  check.title = 'Open in a new browser tab (target="_blank")';
  check.append(box, "new tab");

  const fetchBtn = el("button", "", "⤓");
  fetchBtn.title = "Fetch favicon from the site";
  const resetBtn = el("button", "", "↺");
  resetBtn.title = "Reset icon";
  const del = el("button", "del", "×");
  del.title = "Remove shortcut";

  const refreshIcon = () => r.querySelector(".ico").replaceWith(iconEl(normalize(link), mergedIcons()));

  name.addEventListener("input", () => (link.name = name.value));
  url.addEventListener("input", () => (link.url = url.value));
  url.addEventListener("change", refreshIcon);
  name.addEventListener("change", refreshIcon);
  box.addEventListener("change", () => {
    if (box.checked) link.target = "_blank";
    else delete link.target;
  });
  fetchBtn.addEventListener("click", () => fetchFor(link, fetchBtn, refreshIcon));
  resetBtn.addEventListener("click", () => {
    const host = hostOf(normalize(link).url);
    if (!host) return;
    pendingIcons[host] = null;
    refreshIcon();
    msg(`icon for ${host} reset — Save to apply`);
  });
  del.addEventListener("click", () => {
    draft.splice(i, 1);
    renderRows();
  });

  // drag only from the handle so the inputs stay selectable
  handle.addEventListener("mousedown", () => (r.draggable = true));
  r.addEventListener("dragstart", (e) => {
    dragIndex = i;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  });
  r.addEventListener("dragend", () => {
    r.draggable = false;
    dragIndex = -1;
    rows.querySelectorAll(".sc-row").forEach((x) => x.classList.remove("drop-before", "drop-after"));
  });
  r.addEventListener("dragover", (e) => {
    if (dragIndex < 0 || dragIndex === i) return;
    e.preventDefault();
    const b = r.getBoundingClientRect();
    const after = e.clientY > b.top + b.height / 2;
    r.classList.toggle("drop-after", after);
    r.classList.toggle("drop-before", !after);
  });
  r.addEventListener("dragleave", () => r.classList.remove("drop-before", "drop-after"));
  r.addEventListener("drop", (e) => {
    e.preventDefault();
    const after = r.classList.contains("drop-after");
    const [moved] = draft.splice(dragIndex, 1);
    let to = i + (after ? 1 : 0);
    if (dragIndex < to) to--;
    draft.splice(to, 0, moved);
    dragIndex = -1;
    renderRows();
  });

  r.append(handle, iconEl(normalize(link), mergedIcons()), name, url, check, fetchBtn, resetBtn, del);
  return r;
}

/* ---------- favicon download ---------- */

async function fetchFor(link, btn, refreshIcon) {
  let u;
  try {
    u = new URL(normalize(link).url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return msg("enter a valid http(s) URL first", "err");
  }
  btn.disabled = true;
  try {
    // must be the first await: the permission prompt needs the click's user gesture
    const granted = await chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] });
    if (!granted) throw new Error("permission denied");
    msg(`fetching icon for ${u.hostname}…`);
    const data = await fetchIcon(u);
    if (!data) throw new Error("no icon found");
    pendingIcons[u.hostname] = data;
    refreshIcon();
    msg(`icon for ${u.hostname} fetched — Save to apply`, "ok");
  } catch (e) {
    msg(`${u.hostname}: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

/* /favicon.ico first, then <link rel=icon> from the home page; result is a 32x32 PNG data URL */
async function fetchIcon(u) {
  const icon = await tryIcon(`${u.origin}/favicon.ico`);
  if (icon) return icon;
  try {
    const html = await (await fetch(`${u.origin}/`)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tags = doc.querySelectorAll('link[rel~="icon" i], link[rel~="apple-touch-icon" i]');
    for (const tag of tags) {
      const href = tag.getAttribute("href");
      if (!href) continue;
      const found = await tryIcon(new URL(href, `${u.origin}/`).href);
      if (found) return found;
    }
  } catch {}
  return null;
}

async function tryIcon(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const obj = URL.createObjectURL(blob);
    try {
      const img = await loadImg(obj);
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      c.getContext("2d").drawImage(img, 0, 0, 32, 32);
      return c.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(obj);
    }
  } catch {
    return null;
  }
}
