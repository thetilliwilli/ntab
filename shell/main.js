/* entry point: theme, screens (home / settings / apps) and the bottom navigation; apps live in apps/<id>/ (see
   apps.js), data in shared/db.js */

import * as db from "../shared/db.js";
import * as settings from "../shared/settings.js";
import { apps, appById } from "./apps.js";
import { initActions } from "./actions.js";
import { initHome } from "./home.js";
import { initActionsDialog } from "./actions-dialog.js";
import { initActionForm } from "./action-form.js";
import { initRequestDialog } from "./request.js";
import { initData, checkReminder } from "./data.js";
import { getView, setView, onView, setViews, isView } from "./view.js";
import { initUpdate } from "./update.js";
import { $, isTouch } from "../shared/util.js";
import { startSync } from "../shared/sync.js";

setViews(["home", "settings", ...apps.map((a) => a.id)]);

/* a segmented control in Settings: marks the button of the value */
const markSeg = (id, value) => $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.value === value));
const onSeg = (id, fn) => $(id).addEventListener("click", (e) => e.target.closest("button[data-value]") && fn(e.target.closest("button").dataset.value));

/* ---------- theme ---------- */

function applyTheme({ theme }) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme); // shell/theme.js applies it before the first paint next time
  } catch {}
  markSeg("set-theme", theme);
}

settings.subscribeSettings(applyTheme);
onSeg("set-theme", (theme) => settings.updateSettings({ theme }));

/* ---------- start screen (this device): "auto" = the tracker on a touch screen (a phone), home otherwise ---------- */

const startPref = async () => (await db.getDevice("start"))?.value ?? "auto";
const resolveStart = (pref) => (pref === "auto" ? (isTouch() ? "tracker" : "home") : isView(pref) ? pref : "home");

onSeg("set-start", (value) => {
  markSeg("set-start", value);
  db.setDevice("start", { value }).catch(console.error);
});
db.onChange(({ store }) => store === "device" && startPref().then((v) => markSeg("set-start", v), console.error));

/* ---------- screens; an app loads its data when it is first opened on the page ---------- */

const started = new Map(); // app -> promise of its start()

function show(view) {
  const app = appById(view);
  $("home").hidden = view !== "home";
  $("settings").hidden = view !== "settings";
  for (const a of apps) $(`app-${a.id}`).hidden = a !== app;
  // the bottom navigation: the screen in front is lit, its own button sits in the slot after the separator
  for (const b of $("bnav").querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === view);
  for (const b of $("bnav").querySelectorAll("[data-for]")) b.hidden = b.dataset.for !== view;
}

async function enter(view) {
  const app = appById(view);
  if (!app) return checkReminder(); // home: the backup reminder may be due; settings: the last backup
  if (!started.has(app)) started.set(app, app.start().catch((e) => (started.delete(app), Promise.reject(e))));
  await started.get(app);
  if (app === appById(getView())) app.show();
}

onView((view) => {
  document.title = view === "home" ? "new" : view === "settings" ? "Settings" : appById(view).name; // "new" is also the static <title>
  show(view);
  enter(view).catch(console.error);
});

$("bnav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view);
});

/* ---------- start ---------- */

for (const app of apps) app.init();
initHome();
initActionsDialog();
initActionForm();
initRequestDialog();
initUpdate();
initData({ flush: () => Promise.all([...started.keys()].map((a) => a.flush?.())) });
const [pref] = await Promise.all([startPref().catch(() => "auto"), settings.loadSettings()]);
markSeg("set-start", pref);
setView(resolveStart(pref));
initActions().catch(console.error);
startSync();
