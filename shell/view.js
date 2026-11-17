/* which screen the page shows: "home" (action tiles), "settings" or an app id, also in the address as a route
   ("#/notes"). a page load opens the start screen of this device (Settings; main.js), whatever the address says;
   switching screens replaces the address instead of adding history entries */

import { routeOf } from "../shared/util.js";

let current = null; // none until main.js opens the start screen
let known = new Set(["home"]);
const listeners = new Set();

export const getView = () => current;
export const onView = (fn) => listeners.add(fn);
export const isView = (view) => known.has(view);
export const setViews = (views) => (known = new Set(views));

const address = (view) => location.pathname + location.search + (view === "home" ? "" : `#/${view}`);

export function setView(view) {
  if (!known.has(view)) view = "home";
  if (view === current) return;
  current = view;
  history.replaceState(null, "", address(view));
  listeners.forEach((fn) => fn(view));
}

/* a route typed into the address bar (once the page has started) */
window.addEventListener("hashchange", () => current && setView(routeOf(location.hash) ?? "home"));
