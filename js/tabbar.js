import * as notes from "./notes.js";
import { askClose } from "./dialogs.js";
import { $, el, base } from "./util.js";

const box = $("tabs");
let dragName = null;
let renaming = false;

export function initTabbar() {
  notes.subscribe(render);
  $("tab-add").addEventListener("click", () => notes.create().catch((e) => notes.report(e.message)));
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
  if (renaming || dragName) return;
  box.textContent = "";
  const active = notes.getActive();
  for (const name of notes.getOrder()) {
    const n = notes.getNote(name);
    const tab = el("div", "tab");
    tab.classList.toggle("active", name === active);
    tab.classList.toggle("dirty", n.dirty);
    tab.classList.toggle("err", !!n.error);
    tab.title = name;
    tab.draggable = true;

    const label = el("span", "tab-name", base(name));
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

    tab.addEventListener("dragstart", (e) => {
      dragName = name;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", name);
    });
    tab.addEventListener("dragend", () => {
      dragName = null;
      render();
    });
    tab.addEventListener("dragover", (e) => {
      if (!dragName || dragName === name) return;
      e.preventDefault();
      const r = tab.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      tab.classList.toggle("drop-after", after);
      tab.classList.toggle("drop-before", !after);
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (e) => {
      e.preventDefault();
      const after = tab.classList.contains("drop-after");
      const order = notes.getOrder();
      const before = after ? (order[order.indexOf(name) + 1] ?? null) : name;
      const moving = dragName;
      dragName = null;
      notes.move(moving, before);
    });

    box.append(tab);
    if (name === active) requestAnimationFrame(() => tab.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
}

function startRename(tab, label, name) {
  renaming = true;
  tab.draggable = false;
  const input = el("input", "tab-rename");
  input.value = base(name);
  input.spellcheck = false;
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    renaming = false;
    if (commit && value && value !== base(name)) {
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
