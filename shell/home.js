/* the home screen: the backup reminder, and the actions as tiles in their order; the last tile adds a link */

import { shownActions, subscribeActions, actionEl, iconEl, appOf } from "./actions.js";
import { openAddDialog } from "./add-link.js";
import { $, el } from "../shared/util.js";

const grid = $("home-grid");

function tile(action) {
  const t = actionEl(action, "tile");
  t.title = appOf(action)?.name ?? action.options.url;
  t.append(iconEl(action), el("span", "tile-name", action.name));
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

const render = () => grid.replaceChildren(...shownActions().map(tile), addTile());

export const initHome = () => subscribeActions(render);
