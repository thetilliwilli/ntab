/* the home screen: the backup reminder, and the actions as tiles in their order; the last tile adds an action;
   the GitHub corner and the version (manifest.json; the web version adds its build, the cache of sw.js) */

import { shownActions, subscribeActions, actionEl, iconEl, appOf, describe } from "./actions.js";
import { openAddDialog, actionMenu } from "./action-form.js";
import { $, el } from "../shared/util.js";

const grid = $("home-grid");

function tile(action) {
  const t = actionEl(action, "tile");
  t.title = appOf(action)?.name ?? describe(action);
  t.append(iconEl(action), el("span", "tile-name", action.name));
  t.addEventListener("contextmenu", (e) => actionMenu(e, action));
  return t;
}

function addTile() {
  const b = el("button", "tile tile-add");
  b.type = "button";
  b.title = "Add an action";
  b.append(el("span", "ico", "+"), el("span", "tile-name", "Add"));
  b.addEventListener("click", openAddDialog);
  return b;
}

const render = () => grid.replaceChildren(...shownActions().map(tile), addTile());

/* "v2.2.0", on the web "v2.2.0 · build 1a2b3c4d" (the files this page came from) */
async function showVersion() {
  try {
    let text = `v${(await (await fetch("manifest.json")).json()).version}`;
    const build = navigator.serviceWorker?.controller && (await caches.keys()).find((k) => k.startsWith("ntab-"));
    if (build) text += ` · build ${build.slice(5, 13)}`;
    $("app-ver").textContent = text;
  } catch {} // offline before the first cache, or no manifest: no version shown
}

export function initHome() {
  subscribeActions(render);
  showVersion();
}
