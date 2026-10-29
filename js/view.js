/* which screen the page shows: "home" (action tiles) or "notes" (the notepad). every page load starts at home,
   so notes never show up by themselves (screen sharing); switching is not kept in history or storage */

const TITLES = { home: "new", notes: "Notes" }; // page title per screen; "new" is also the static <title>

let current = "home";
const listeners = new Set();

export const getView = () => current;
export const onView = (fn) => listeners.add(fn);

export function setView(view) {
  if (view === current) return;
  current = view;
  document.title = TITLES[view];
  listeners.forEach((fn) => fn(view));
}
