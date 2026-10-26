import * as notes from "./notes.js";
import { askClose } from "./dialogs.js";
import { $, el, extStart, sortable, isDragging } from "./util.js";

const box = $("tabs");
let renaming = false;
let shown = null; // tab order the strip was built for; saves only flip classes, they don't rebuild it
let shownActive = null;

export function initTabbar() {
  notes.subscribe(render);
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
    const n = notes.getNote(tab.dataset.name);
    tab.classList.toggle("active", tab.dataset.name === active);
    tab.classList.toggle("dirty", !!n?.dirty);
    tab.classList.toggle("err", !!n?.error);
  }
  if (active !== shownActive) {
    shownActive = active;
    box.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function tabEl(name) {
  const tab = el("div", "tab");
  tab.dataset.name = name;
  tab.title = name;
  tab.draggable = true;

  const label = el("span", "tab-name", name);
  const x = el("button", "tab-x", "×");
  x.title = "Close";
  tab.append(label, x);

  tab.addEventListener("click", () => name !== notes.getActive() && notes.activate(name));
  tab.addEventListener("auxclick", (e) => e.button === 1 && askClose(name));
  label.addEventListener("dblclick", () => startRename(tab, label, name));
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    askClose(name);
  });
  sortable(tab, {
    group: "tabs",
    key: name,
    onDrop(from, to, after) {
      const order = notes.getOrder();
      notes.move(from, after ? (order[order.indexOf(to) + 1] ?? null) : to);
    },
    onEnd: render,
  });
  return tab;
}

function startRename(tab, label, name) {
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
        await notes.rename(name, value);
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
