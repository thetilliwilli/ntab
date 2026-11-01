/* "add link" dialog: the "+" tile on the home screen adds one web address */

import { iconEl, addAction, newAction } from "./actions.js";
import { pickFile, iconFromFile } from "./icon-file.js";
import { $, hostOf, fixUrl } from "../shared/util.js";

const addDlg = $("add");
const addUrl = $("add-url");
const addName = $("add-name");
let addIcon = null; // uploaded icon for the new link, data URL

/* default name from the URL: "https://www.github.com/x" -> "github.com" */
const nameFromUrl = (url) => (hostOf(fixUrl(url)) || "").replace(/^www\./, "");

function action() {
  const url = addUrl.value.trim();
  const a = newAction(addName.value.trim() || nameFromUrl(url), url && fixUrl(url), $("add-blank").checked);
  a.icon = addIcon;
  return a;
}

function addMsg(text, kind = "") {
  const m = $("add-msg");
  m.textContent = text;
  m.className = `msg ${kind}`;
}

function refreshAddIcon() {
  const a = action();
  const ico = iconEl({ ...a, name: a.name || "?" });
  ico.id = "add-ico";
  $("add-ico").replaceWith(ico);
  addName.placeholder = nameFromUrl(addUrl.value) || "Name";
  $("add-reset").hidden = !addIcon;
  $("add-ico-note").textContent = addIcon ? "your upload" : hostOf(a.options.url) ? "from Chrome's cache of the site" : "";
}

export function openAddDialog() {
  addUrl.value = addName.value = "";
  $("add-blank").checked = false;
  addIcon = null;
  addMsg("");
  refreshAddIcon();
  addDlg.showModal();
  addUrl.focus();
}

export function initAddDialog() {
  addUrl.addEventListener("input", () => (addName.placeholder = nameFromUrl(addUrl.value) || "Name"));
  addUrl.addEventListener("change", refreshAddIcon);
  addName.addEventListener("change", refreshAddIcon);
  $("add-x").addEventListener("click", () => addDlg.close());
  $("add-cancel").addEventListener("click", () => addDlg.close());
  $("add-reset").addEventListener("click", () => {
    addIcon = null;
    refreshAddIcon();
  });
  $("add-upload").addEventListener("click", async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      addIcon = await iconFromFile(file);
      addMsg("");
    } catch {
      addMsg(`${file.name}: not an image the browser can read`, "err");
    }
    refreshAddIcon();
  });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = action();
    if (!hostOf(a.options.url)) {
      addMsg("enter a valid URL", "err");
      return addUrl.focus();
    }
    try {
      await addAction(a);
      addDlg.close();
    } catch (err) {
      addMsg(err.message, "err");
    }
  });
}
