/* sidebar: home button, action icons (with a hover flyout and edge arrows), theme and edit buttons */

import { shownActions, subscribeActions, actionEl, iconEl, appOf, describe } from "./actions.js";
import { getView, setView, onView } from "./view.js";
import { actionMenu } from "./action-form.js";
import { $, el } from "../shared/util.js";

const side = $("links");

/* hover flyout over the sidebar: icon + full name + url; clicking it does what the icon does */
const fly = el("a", "flyout");
let flyAction = null;
fly.hidden = true;
document.body.append(fly);
fly.addEventListener("mouseleave", () => (fly.hidden = true));
fly.addEventListener("click", (e) => {
  const app = flyAction && appOf(flyAction);
  if (app || flyAction?.kind === "request") {
    e.preventDefault();
    if (app) setView(app.id);
    else side.querySelector(`[data-id="${flyAction.id}"]`)?.click(); // the icon runs the request
  }
  fly.hidden = true;
});
/* right-click: the flyout covers the icon, so it opens the icon's menu */
fly.addEventListener("contextmenu", (e) => {
  fly.hidden = true;
  if (flyAction) actionMenu(e, flyAction);
});
/* the flyout covers the icon under the cursor, so the wheel lands on it: scroll the sidebar instead */
fly.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    side.scrollTop += e.deltaMode ? e.deltaY * 48 : e.deltaY;
  },
  { passive: false },
);
side.addEventListener("scroll", () => {
  fly.hidden = true;
  markMore();
});

/* arrows above and below the icons while they don't fit (in the flow, not over the icons); the one at the edge is
   disabled rather than hidden, so nothing moves under a cursor that keeps clicking. click scrolls by a page */
const wrap = side.parentElement;
function markMore() {
  const top = side.scrollTop;
  wrap.classList.toggle("overflow", side.scrollHeight > side.clientHeight + 1);
  $("links-up").disabled = top <= 1;
  $("links-down").disabled = top + side.clientHeight >= side.scrollHeight - 1;
}
const page = (dir) => side.scrollBy({ top: dir * (side.clientHeight - 48), behavior: "smooth" });
$("links-up").addEventListener("click", () => page(-1));
$("links-down").addEventListener("click", () => page(1));
new ResizeObserver(markMore).observe(side);
window.addEventListener("blur", () => (fly.hidden = true));

function showFlyout(a, action) {
  flyAction = action;
  const link = action.kind === "open" && !appOf(action);
  if (link) fly.href = action.options.url;
  else fly.removeAttribute("href");
  if (link && action.options.newTab) fly.target = "_blank";
  else fly.removeAttribute("target");
  fly.textContent = "";
  fly.append(a.querySelector(".ico").cloneNode(true), el("span", "fly-name", action.name), el("span", "fly-url", describe(action)));
  const r = a.getBoundingClientRect();
  fly.style.top = `${r.top}px`;
  fly.style.left = `${r.left}px`;
  fly.style.height = `${r.height}px`;
  fly.style.minWidth = `${r.width}px`;
  fly.hidden = false;
}

function render() {
  side.textContent = "";
  for (const action of shownActions()) {
    const item = actionEl(action, "link");
    item.setAttribute("aria-label", action.name);
    item.dataset.id = action.id;
    item.append(iconEl(action));
    item.addEventListener("mouseenter", () => showFlyout(item, action));
    item.addEventListener("contextmenu", (e) => actionMenu(e, action));
    side.append(item);
  }
  markView();
  markMore();
}

function markView() {
  const view = getView();
  $("go-home").classList.toggle("on", view === "home");
  side.querySelectorAll(".app").forEach((n) => n.classList.toggle("on", n.dataset.app === view));
}

export function initSidebar() {
  subscribeActions(render);
  onView(() => {
    fly.hidden = true;
    markView();
  });
  $("go-home").addEventListener("click", () => setView("home"));
}
