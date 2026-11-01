/* the right-click menu: one for the page, filled per use. showMenu(event, [{ label, danger?, run }]);
   picking an item closes it, so does Escape, a click elsewhere, scrolling the page away or leaving the window */

import { el } from "./util.js";

const menu = el("div", "ctx-menu");
menu.hidden = true;
menu.setAttribute("role", "menu");
document.body.append(menu);

export const closeMenu = () => (menu.hidden = true);

export function showMenu(e, items) {
  e.preventDefault();
  menu.replaceChildren(
    ...items.map(({ label, danger, run }) => {
      const b = el("button", `ctx-item${danger ? " danger" : ""}`, label);
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => {
        closeMenu();
        run();
      });
      return b;
    }),
  );
  menu.hidden = false;
  // keep it inside the window
  menu.style.left = `${Math.min(e.clientX, innerWidth - menu.offsetWidth - 4)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - menu.offsetHeight - 4)}px`;
  menu.firstElementChild?.focus();
}

menu.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
menu.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerdown", (e) => !menu.contains(e.target) && closeMenu(), true);
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);
