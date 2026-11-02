/* a new version of the web app has taken over (platform onUpdate): the page reloads into it at the first safe moment,
   on the home screen with no dialog open, or when the page is hidden (apps save on pagehide); until then a bar offers
   to reload now */

import * as platform from "../platform/index.js";
import { getView, onView } from "./view.js";
import { $ } from "../shared/util.js";

let pending = false;
const busy = () => !!document.querySelector("dialog[open]"); // e.g. the actions editor with unsaved changes

function maybeReload(hidden = false) {
  if (pending && !busy() && (hidden || getView() === "home")) location.reload();
}

export function initUpdate() {
  platform.onUpdate(() => {
    pending = true;
    maybeReload(document.hidden);
    if (pending) $("update-bar").hidden = false;
  });
  onView(() => maybeReload());
  document.addEventListener("close", () => setTimeout(maybeReload), true); // a dialog closed
  document.addEventListener("visibilitychange", () => document.hidden && maybeReload(true));
  $("update-reload").addEventListener("click", () => location.reload());
}
