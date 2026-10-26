import * as settings from "./settings.js";
import * as fs from "./fs.js";
import * as notes from "./notes.js";
import * as editor from "./editor.js";
import { initSidebar } from "./sidebar.js";
import { initShortcutsDialog } from "./shortcuts.js";
import { initFilesDialog, initClosePanel } from "./dialogs.js";
import { initTabbar } from "./tabbar.js";
import { $ } from "./util.js";

/* ---------- settings ---------- */

let cfg = settings.DEFAULT_SETTINGS;

function applyTheme(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme); // read synchronously on next load to avoid a theme flash
  } catch {}
}

try {
  applyTheme(localStorage.getItem("theme") || "auto");
} catch {}

function apply(s) {
  cfg = s;
  applyTheme(s.theme);
  document.body.classList.toggle("collapsed", s.sidebarCollapsed);
  editor.configure(s);
  $("font-size").textContent = s.fontSize;
  $("wrap").classList.toggle("on", s.wrap);
  $("wrap").setAttribute("aria-pressed", s.wrap);
  $("tab-size").value = s.tabSize;
  $("theme").value = s.theme;
}

function update(patch) {
  apply({ ...cfg, ...patch });
  settings.saveSettings(cfg);
}

$("font-dec").addEventListener("click", () => update({ fontSize: Math.max(9, cfg.fontSize - 1) }));
$("font-inc").addEventListener("click", () => update({ fontSize: Math.min(32, cfg.fontSize + 1) }));
$("wrap").addEventListener("click", () => update({ wrap: !cfg.wrap }));
$("tab-size").addEventListener("change", (e) => update({ tabSize: Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 4)) }));
$("theme").addEventListener("change", (e) => update({ theme: e.target.value }));
$("side-toggle").addEventListener("click", () => update({ sidebarCollapsed: !cfg.sidebarCollapsed }));

/* ---------- editor / status bar ---------- */

editor.init({
  onInput: notes.onEdit,
  onView: notes.onView,
  onCursor({ ln, col, len, sel }) {
    $("st-pos").textContent = `Ln ${ln}, Col ${col}${sel ? ` (${sel} sel)` : ""}`;
    $("st-len").textContent = `${len} chars`;
  },
});

notes.onStatus((text, kind) => {
  const s = $("st-save");
  s.textContent = text;
  s.dataset.kind = kind;
});

initTabbar();
initClosePanel();
initFilesDialog({ onChangeFolder: () => changeFolder().catch(showError) });
initShortcutsDialog();

apply(await settings.loadSettings());
settings.onSettingsChanged(apply);
initSidebar().catch(console.error);

/* ---------- notes folder ---------- */

function showError(e) {
  if (e?.name !== "AbortError") notes.report(e?.message || String(e));
}

function setReady(ready) {
  $("gate").hidden = ready;
  $("editor").hidden = !ready;
  $("tab-add").disabled = !ready;
  $("tab-open").disabled = !ready;
}

function gate(message, label, action, alt = false) {
  setReady(false);
  $("gate-msg").textContent = message;
  const btn = $("gate-btn");
  btn.hidden = !label;
  btn.textContent = label || "";
  btn.onclick = () =>
    action().catch((e) => {
      if (e.name !== "AbortError") $("gate-msg").textContent = `${message}\n\n${e.message}`;
    });
  $("gate-alt").hidden = !alt;
}

async function start(opts) {
  setReady(true);
  await notes.start(opts);
  editor.focus();
}

async function choose() {
  await fs.pickDir();
  await start({ fresh: true });
}

async function changeFolder() {
  await notes.flushAll();
  await fs.pickDir();
  await chrome.storage.local.remove("session");
  await start({ fresh: true });
}

$("gate-alt").addEventListener("click", () => choose().catch(showError));

async function connect() {
  if (!("showDirectoryPicker" in window)) {
    return gate("This browser does not support the File System Access API.");
  }
  const dir = await fs.restoreDir();
  if (!dir) {
    return gate("Choose a folder where notes will be kept as .txt files.\nEvery change is saved there instantly.", "choose folder…", choose);
  }
  if (await fs.hasPermission()) return start().catch((e) => gate(`Cannot open “${dir.name}”:\n${e.message}`, "choose folder…", choose));
  gate(
    `Chrome needs your OK to access the notes folder “${dir.name}” again.\nTip: pick “Allow on every visit” to skip this step next time.`,
    "connect folder",
    async () => {
      if (await fs.requestPermission()) await start();
    },
    true,
  );
}

await connect();
