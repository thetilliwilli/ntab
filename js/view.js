/* which screen the page shows: "home" (action tiles) or "notes" (the notepad). every page load starts at home,
   so notes never show up by themselves (screen sharing); switching is not kept in history or storage */

let current = "home";
const listeners = new Set();

export const getView = () => current;
export const onView = (fn) => listeners.add(fn);

export function setView(view) {
  if (view === current) return;
  current = view;
  listeners.forEach((fn) => fn(view));
}
