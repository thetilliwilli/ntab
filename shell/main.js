/* entry point: theme, screens (home / apps); apps live in apps/<id>/ (see apps.js), data in shared/db.js */

import * as settings from "../shared/settings.js";
import { apps, appById } from "./apps.js";
import { initActions } from "./actions.js";
import { initSidebar } from "./sidebar.js";
import { initHome } from "./home.js";
import { initActionsDialog } from "./actions-dialog.js";
import { initActionForm } from "./action-form.js";
import { initRequestDialog } from "./request.js";
import { initData, checkReminder } from "./data.js";
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

/* ---------- screens: home / an app; an app loads its data when it is first opened on the page ---------- */

const started = new Map(); // app -> promise of its start()

function show() {
  const app = appById(getView());
  $("home").hidden = !!app;
  for (const a of apps) $(`app-${a.id}`).hidden = a !== app;
}

async function enter() {
  const app = appById(getView());
  if (!app) return checkReminder();
  if (!started.has(app)) started.set(app, app.start().catch((e) => (started.delete(app), Promise.reject(e))));
  await started.get(app);
  if (app === appById(getView())) app.show();
}

onView((view) => {
  document.title = appById(view)?.name ?? "new"; // "new" is also the static <title>
  show();
  enter().catch(console.error);
});

/* ---------- start ---------- */

for (const app of apps) app.init();
initSidebar();
initHome();
initActionsDialog();
initActionForm();
initRequestDialog();
initData({ flush: () => Promise.all([...started.keys()].map((a) => a.flush?.())) });
await settings.loadSettings();
initActions().catch(console.error);
