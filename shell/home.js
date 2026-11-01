/* the home screen: the action list as tiles, apps under "Apps", links under "Links" (the sidebar keeps the
   list order); the last "Links" tile adds one link */

import { getIconMap, shownActions, subscribeActions, actionEl, iconEl } from "./actions.js";
import { openAddDialog } from "./add-link.js";
import { $, el, isApp } from "../shared/util.js";

const grid = $("home-grid");

function tile(link) {
  const t = actionEl(link, "tile");
  t.title = isApp(link) ? link.name : link.url;
  t.append(iconEl(link, getIconMap()), el("span", "tile-name", link.name));
  return t;
}

function addTile() {
  const b = el("button", "tile tile-add");
  b.type = "button";
  b.title = "Add a link";
  b.append(el("span", "ico", "+"), el("span", "tile-name", "Add"));
  b.addEventListener("click", openAddDialog);
  return b;
}

function render() {
  const list = shownActions();
  const apps = list.filter(isApp);
  grid.textContent = "";
  if (apps.length) grid.append(el("h2", "home-head", "Apps"), ...apps.map(tile));
  grid.append(el("h2", "home-head", "Links"), ...list.filter((l) => !isApp(l)).map(tile), addTile());
}

export const initHome = () => subscribeActions(render);
