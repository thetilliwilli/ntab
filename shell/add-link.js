/* "add link" dialog: the "+" tile on the home screen adds one link */

import { getLinks, getIconMap, iconEl } from "./actions.js";
import { pickFile, iconFromFile } from "./icon-file.js";
import { saveLinks, setIcons } from "../shared/settings.js";
import { $, hostOf, fixUrl } from "../shared/util.js";

const addDlg = $("add");
const addUrl = $("add-url");
const addName = $("add-name");
let addIcon = null; // uploaded icon for the new link, data URL

/* default name from the URL: "https://www.github.com/x" -> "github.com" */
const nameFromUrl = (url) => (hostOf(fixUrl(url)) || "").replace(/^www\./, "");

function addLink() {
  const url = addUrl.value.trim();
  const link = { name: addName.value.trim() || nameFromUrl(url), url: url && fixUrl(url) };
  if ($("add-blank").checked) link.target = "_blank";
  return link;
}

function addMsg(text, kind = "") {
  const m = $("add-msg");
  m.textContent = text;
  m.className = `msg ${kind}`;
}

function refreshAddIcon() {
  const link = addLink();
  const key = hostOf(link.url);
  const icons = key && addIcon ? { ...getIconMap(), [key]: addIcon } : getIconMap();
  const ico = iconEl({ ...link, name: link.name || "?" }, icons);
  ico.id = "add-ico";
  $("add-ico").replaceWith(ico);
  addName.placeholder = nameFromUrl(addUrl.value) || "Name";
  $("add-reset").hidden = !addIcon;
  $("add-ico-note").textContent = addIcon ? "your upload" : !key ? "" : getIconMap()[key] ? "uploaded earlier" : "from Chrome's cache of the site";
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
    const link = addLink();
    const key = hostOf(link.url);
    if (!key) {
      addMsg("enter a valid URL", "err");
      return addUrl.focus();
    }
    try {
      await saveLinks([...getLinks(), link]);
      if (addIcon) await setIcons({ ...getIconMap(), [key]: addIcon });
      addDlg.close();
    } catch (err) {
      addMsg(err.message, "err");
    }
  });
}
