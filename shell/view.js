/* which screen the page shows: "home" (action tiles) or an app id, also in the address as a route ("#/notes").
   every page load starts at home, so notes never show up by themselves (screen sharing); switching screens replaces
   the address instead of adding history entries */

import { routeOf } from "../shared/util.js";

let current = "home";
const listeners = new Set();

export const getView = () => current;
export const onView = (fn) => listeners.add(fn);

const address = (view) => location.pathname + location.search + (view === "home" ? "" : `#/${view}`);

export function setView(view) {
  if (view === current) return;
  current = view;
  history.replaceState(null, "", address(view));
  listeners.forEach((fn) => fn(view));
}

if (location.hash) history.replaceState(null, "", address("home")); // a reload or a restored tab: back to home

/* a route typed into the address bar */
window.addEventListener("hashchange", () => setView(routeOf(location.hash) ?? "home"));
