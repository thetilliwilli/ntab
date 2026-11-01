/* entry point: theme, the data folder gate, screens (home / apps); apps live in apps/<id>/ (see apps.js) */

import * as settings from "../shared/settings.js";
import * as folder from "../shared/folder.js";
import { apps, appById } from "./apps.js";
import { initActions } from "./actions.js";
import { initSidebar } from "./sidebar.js";
import { initHome } from "./home.js";
import { initActionsDialog } from "./actions-dialog.js";
import { initAddDialog } from "./add-link.js";
import { getView, onView } from "./view.js";
import { $ } from "../shared/util.js";

/* ---------- theme ---------- */

const THEMES = ["auto", "light", "dark"];
const THEME_ICONS = {
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  dark: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
};

function applyTheme({ theme }) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme); // shell/theme.js applies it before the first paint next time
  } catch {}
  const btn = $("theme-btn");
  btn.title = `Theme: ${theme} (click to switch)`;
  btn.firstElementChild.innerHTML = THEME_ICONS[theme] || THEME_ICONS.auto;
}

settings.subscribeSettings(applyTheme);
$("theme-btn").addEventListener("click", () => {
  const { theme } = settings.getSettings();
  settings.updateSettings({ theme: THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] });
});

/* ---------- data folder ---------- */

let ready = false; // the data folder is open and may be used
let fresh = false; // another folder was picked on this page: apps start without their saved session
let connecting = null;
const live = new Set(); // apps started on the current folder

const logError = (e) => e?.name !== "AbortError" && console.error(e);

/* home, the current app, or the gate in its place while the folder isn't open */
function show() {
  const app = appById(getView());
  $("home").hidden = !!app;
  for (const a of apps) $(`app-${a.id}`).hidden = a !== app || (a.needsFolder && !ready);
  $("gate").hidden = !app?.needsFolder || ready;
}

function gate(message, label, action, alt = false) {
  ready = false;
  live.clear();
  show();
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

const cannotOpen = (e) => gate(`Cannot open “${folder.getDir()?.name}”:\n${e.message}`, "choose folder…", choose);

/* brings the current app to a working state: folder open, app started, app shown */
async function enter() {
  const app = appById(getView());
  if (!app) return;
  if (!app.needsFolder) return app.show();
  if (!ready) return (connecting ??= connect().catch(logError));
  if (!live.has(app)) {
    live.add(app);
    try {
      await app.start({ fresh });
    } catch (e) {
      live.delete(app);
      return cannotOpen(e);
    }
  }
  if (app === appById(getView())) app.show();
}

async function folderReady() {
  ready = true;
  show();
  await enter();
}

async function choose() {
  await folder.pickDir();
  fresh = true;
  live.clear();
  await folderReady();
}

async function changeFolder() {
  await Promise.all([...live].map((a) => a.flush?.()));
  await choose();
}

async function connect() {
  if (!("showDirectoryPicker" in window)) {
    return gate("This browser does not support the File System Access API.");
  }
  const dir = await folder.restoreDir();
  if (!dir) {
    return gate("Choose a folder where notes will be kept as plain text files.\nEvery change is saved there instantly.", "choose folder…", choose);
  }
  if (await folder.hasPermission()) return folderReady();
  gate(
    `Chrome needs your OK to access the notes folder “${dir.name}” again.\nTip: pick “Allow on every visit” to skip this step next time.`,
    "connect folder",
    async () => {
      if (await folder.requestPermission()) await folderReady();
    },
    true,
  );
}

$("gate-alt").addEventListener("click", () => choose().catch(logError));

/* ---------- screens: home / an app; the folder is touched only when an app that needs it is first opened ---------- */

onView((view) => {
  document.title = appById(view)?.name ?? "new"; // "new" is also the static <title>
  show();
  enter().catch(logError);
});

/* ---------- start ---------- */

const ctx = { changeFolder };
for (const app of apps) app.init(ctx);
initSidebar();
initHome();
initActionsDialog();
initAddDialog();
await settings.loadSettings();
initActions().catch(console.error);
