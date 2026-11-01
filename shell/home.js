/* the home screen: the backup reminder, and the actions as tiles in their order; the last tile adds an action */

import { shownActions, subscribeActions, actionEl, iconEl, appOf, describe } from "./actions.js";
import { openAddDialog } from "./action-form.js";
import { $, el } from "../shared/util.js";

const grid = $("home-grid");

function tile(action) {
  const t = actionEl(action, "tile");
  t.title = appOf(action)?.name ?? describe(action);
  t.append(iconEl(action), el("span", "tile-name", action.name));
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

export const initHome = () => subscribeActions(render);
