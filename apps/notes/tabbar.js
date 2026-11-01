import * as notes from "./notes.js";
import { askClose } from "./dialogs.js";
import { $, el, extStart, sortable, isDragging, download } from "../../shared/util.js";

const box = $("tabs");
let renaming = false;
let shown = null; // tab order the strip was built for; saves only flip classes, they don't rebuild it
let shownActive = null;

/* right-click menu on a tab: download the note as a file named after it, delete it (picking it is the confirmation) */
const menu = el("div", "ctx-menu");
const menuDown = el("button", "ctx-item", "Download");
const menuDel = el("button", "ctx-item danger", "Delete note");
let menuFor = null;
menu.hidden = true;
menu.setAttribute("role", "menu");
for (const item of [menuDown, menuDel]) item.setAttribute("role", "menuitem");
menu.append(menuDown, menuDel);
document.body.append(menu);

function openMenu(e, id) {
  e.preventDefault();
  menuFor = id;
  menu.hidden = false;
  // keep it inside the window
  const x = Math.min(e.clientX, innerWidth - menu.offsetWidth - 4);
  const y = Math.min(e.clientY, innerHeight - menu.offsetHeight - 4);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menuDown.focus();
}

const closeMenu = () => (menu.hidden = true);

menuDown.addEventListener("click", () => {
  closeMenu();
  const n = notes.getNote(menuFor);
  if (n) download(n.name, n.text, "application/octet-stream"); // a text type would make Chrome add ".txt" to "todo"
});
menuDel.addEventListener("click", () => {
  closeMenu();
  notes.close(menuFor, true).catch((err) => notes.report(`delete failed: ${err.message}`));
});
menu.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
menu.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerdown", (e) => !menu.contains(e.target) && closeMenu(), true);
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

export function initTabbar() {
  notes.subscribe(render);
  box.addEventListener("scroll", closeMenu);
  // double-click on the free space right of the tabs = new note, like Notepad++
  box.addEventListener("dblclick", (e) => {
    if (e.target === box && !$("tab-add").disabled) notes.create().catch((err) => notes.report(err.message));
  });
  // vertical wheel scrolls the tab strip horizontally
  box.addEventListener(
    "wheel",
    (e) => {
      if (!e.deltaY) return;
      box.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}

function render() {
  if (renaming || isDragging("tabs")) return;
  const order = notes.getOrder();
  const active = notes.getActive();
  const key = order.join("\n");
  if (key !== shown) {
    box.replaceChildren(...order.map(tabEl));
    shown = key;
    shownActive = null;
  }
  for (const tab of box.children) {
    const n = notes.getNote(tab.dataset.id);
    if (n && tab.title !== n.name) {
      tab.title = n.name; // renamed (here or on another page)
      tab.querySelector(".tab-name").textContent = n.name;
    }
    tab.classList.toggle("active", tab.dataset.id === active);
    tab.classList.toggle("dirty", !!n?.dirty);
    tab.classList.toggle("err", !!n?.error);
  }
  if (active !== shownActive) {
    shownActive = active;
    box.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function tabEl(id) {
  const name = notes.getNote(id).name;
  const tab = el("div", "tab");
  tab.dataset.id = id;
  tab.title = name;
  tab.draggable = true;

  const label = el("span", "tab-name", name);
  const x = el("button", "tab-x", "×");
  x.title = "Close";
  tab.append(label, x);

  tab.addEventListener("click", () => id !== notes.getActive() && notes.activate(id));
  tab.addEventListener("auxclick", (e) => e.button === 1 && askClose(id));
  tab.addEventListener("contextmenu", (e) => openMenu(e, id));
  label.addEventListener("dblclick", () => startRename(tab, label, id));
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    askClose(id);
  });
  sortable(tab, {
    group: "tabs",
    key: id,
    onDrop(from, to, after) {
      const order = notes.getOrder();
      notes.move(from, after ? (order[order.indexOf(to) + 1] ?? null) : to);
    },
    onEnd: render,
  });
  return tab;
}

function startRename(tab, label, id) {
  const name = notes.getNote(id)?.name ?? "";
  renaming = true;
  tab.draggable = false;
  const input = el("input", "tab-rename");
  input.value = name;
  input.spellcheck = false;
  label.replaceWith(input);
  input.focus();
  input.setSelectionRange(0, extStart(name)); // like file managers: select the name, not the extension

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    renaming = false;
    shown = null; // the label was swapped for the input: rebuild
    if (commit && value && value !== name) {
      try {
        await notes.rename(id, value);
      } catch (e) {
        notes.report(`rename failed: ${e.message}`);
      }
    }
    render();
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}
