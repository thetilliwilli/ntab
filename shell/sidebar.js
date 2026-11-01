/* sidebar: home button, action icons (with a hover flyout and edge arrows), theme and edit buttons */

import { getIconMap, shownActions, subscribeActions, actionEl, iconEl } from "./actions.js";
import { appById } from "./apps.js";
import { getView, setView, onView } from "./view.js";
import { $, el, isApp } from "../shared/util.js";

const side = $("links");

/* hover flyout over the sidebar: icon + full name + url; clicking it does what the icon does */
const fly = el("a", "flyout");
let flyLink = null;
fly.hidden = true;
document.body.append(fly);
fly.addEventListener("mouseleave", () => (fly.hidden = true));
fly.addEventListener("click", (e) => {
  if (flyLink && isApp(flyLink)) {
    e.preventDefault();
    setView(flyLink.type);
  }
  fly.hidden = true;
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

/* arrows at the edges of the sidebar when icons are cut off; clicking one scrolls by a page */
const wrap = side.parentElement;
function markMore() {
  const top = side.scrollTop;
  wrap.classList.toggle("more-up", top > 1);
  wrap.classList.toggle("more-down", top + side.clientHeight < side.scrollHeight - 1);
}
const page = (dir) => side.scrollBy({ top: dir * (side.clientHeight - 48), behavior: "smooth" });
$("links-up").addEventListener("click", () => page(-1));
$("links-down").addEventListener("click", () => page(1));
new ResizeObserver(markMore).observe(side);
window.addEventListener("blur", () => (fly.hidden = true));

function showFlyout(a, link) {
  flyLink = link;
  if (isApp(link)) fly.removeAttribute("href");
  else fly.href = link.url;
  if (link.target) fly.target = link.target;
  else fly.removeAttribute("target");
  fly.textContent = "";
  const what = isApp(link) ? appById(link.type).what : link.url;
  fly.append(a.querySelector(".ico").cloneNode(true), el("span", "fly-name", link.name), el("span", "fly-url", what));
  const r = a.getBoundingClientRect();
  fly.style.top = `${r.top}px`;
  fly.style.left = `${r.left}px`;
  fly.style.height = `${r.height}px`;
  fly.style.minWidth = `${r.width}px`;
  fly.hidden = false;
}

function render() {
  side.textContent = "";
  for (const link of shownActions()) {
    const item = actionEl(link, "link");
    item.setAttribute("aria-label", link.name);
    item.append(iconEl(link, getIconMap()));
    item.addEventListener("mouseenter", () => showFlyout(item, link));
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
