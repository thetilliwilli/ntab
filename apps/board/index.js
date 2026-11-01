/* the Board app: a kanban board (new / work / hold / done) */

import * as model from "./model.js";
import { $, el, fmtTime } from "../../shared/util.js";

const report = (e) => {
  const t = $("bd-toast");
  $("bd-toast-text").textContent = e?.message || String(e);
  t.hidden = false;
  clearTimeout(report.timer);
  report.timer = setTimeout(() => (t.hidden = true), 8000);
};

/* ---------- columns and cards ---------- */

let drag = null; // { id, card, ghost, x, y, dx, dy, active, status, before }
let dirty = false; // changes that arrived during a drag, drawn when it ends

function render() {
  if (drag?.active) return (dirty = true);
  dirty = false;
  const cols = $("bd-cols");
  cols.textContent = "";
  for (const status of model.STATUSES) {
    const tasks = model.inColumn(status);
    const col = el("section", `bd-col bd-${status}`);
    col.dataset.status = status;
    const head = el("div", "bd-head");
    head.append(el("span", "bd-col-name", model.STATUS_NAMES[status]), el("span", "bd-count", String(tasks.length)));
    if (status === "new") {
      const add = el("button", "bd-add", "+");
      add.title = "New task";
      add.addEventListener("click", () => openTask(null));
      head.append(add);
    }
    const list = el("div", "bd-list");
    for (const t of tasks) list.append(card(t));
    if (!tasks.length) list.append(el("div", "bd-none", "—"));
    col.append(head, list);
    cols.append(col);
  }
}

function card(t) {
  const c = el("div", "bd-card");
  c.dataset.id = t.id;
  c.tabIndex = 0;
  const handle = el("span", "bd-handle", "⋮⋮");
  handle.title = "Drag to move";
  c.append(handle, el("div", "bd-name", t.name));
  if (t.description) c.append(el("div", "bd-desc", t.description));
  c.append(el("div", "bd-meta", fmtTime(t.updatedAt)));
  c.addEventListener("click", () => !c.dataset.noclick && openTask(t));
  c.addEventListener("keydown", (e) => e.key === "Enter" && openTask(t));
  return c;
}

/* ---------- drag and drop (pointer events: mouse and touch) ---------- */

/* the mouse drags a card by any point, a finger only by the handle (the rest of the card scrolls the column) */
$("bd-cols").addEventListener("pointerdown", (e) => {
  const c = e.target.closest(".bd-card");
  if (!c || e.button !== 0) return;
  if (e.pointerType !== "mouse" && !e.target.closest(".bd-handle")) return;
  const r = c.getBoundingClientRect();
  drag = { id: c.dataset.id, card: c, ghost: null, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, active: false, status: null, before: null, pointer: e.pointerId };
});

window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.active = true;
    const r = drag.card.getBoundingClientRect();
    drag.ghost = drag.card.cloneNode(true);
    drag.ghost.classList.add("bd-ghost");
    drag.ghost.style.width = `${r.width}px`;
    document.body.append(drag.ghost);
    drag.card.classList.add("dragging");
    document.body.classList.add("bd-dragging");
  }
  e.preventDefault();
  drag.ghost.style.left = `${e.clientX - drag.dx}px`;
  drag.ghost.style.top = `${e.clientY - drag.dy}px`;
  target(e.clientX, e.clientY);
});

/* column and the card to drop before under the pointer; draws the drop mark */
function target(x, y) {
  document.querySelectorAll(".drop-before, .drop-after, .drop-end").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-end"));
  drag.status = drag.before = null;
  const col = document.elementFromPoint(x, y)?.closest(".bd-col");
  if (!col) return;
  drag.status = col.dataset.status;
  const cards = [...col.querySelectorAll(".bd-card")].filter((c) => c !== drag.card);
  const next = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (next) {
    drag.before = next.dataset.id;
    next.classList.add("drop-before");
  } else (cards.at(-1) ?? col.querySelector(".bd-list")).classList.add(cards.length ? "drop-after" : "drop-end");
}

function endDrag(drop) {
  const d = drag;
  drag = null;
  if (!d) return;
  if (!d.active) return;
  d.ghost.remove();
  d.card.classList.remove("dragging");
  document.body.classList.remove("bd-dragging");
  document.querySelectorAll(".drop-before, .drop-after, .drop-end").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-end"));
  // the click that follows the pointer release must not open the card
  d.card.dataset.noclick = "1";
  setTimeout(() => delete d.card.dataset.noclick);
  if (drop && d.status) model.move(d.id, d.status, d.before).catch(report);
  else if (dirty) render();
}

window.addEventListener("pointerup", (e) => drag && e.pointerId === drag.pointer && endDrag(true));
window.addEventListener("pointercancel", (e) => drag && e.pointerId === drag.pointer && endDrag(false));
window.addEventListener("keydown", (e) => e.key === "Escape" && drag?.active && endDrag(false));

/* ---------- task dialog ---------- */

let editing = null; // task being edited, null = a new one

function openTask(task) {
  editing = task;
  $("bd-task-title").textContent = task ? "Task" : "New task";
  $("bd-name").value = task?.name ?? "";
  $("bd-desc").value = task?.description ?? "";
  $("bd-status").value = task?.status ?? "new";
  $("bd-del").hidden = !task;
  $("bd-task-msg").textContent = task ? `created ${fmtTime(task.createdAt)}` : "";
  $("bd-task").showModal();
  $("bd-name").focus();
}

async function saveTask(e) {
  e?.preventDefault();
  const name = $("bd-name").value.trim();
  if (!name) return ($("bd-task-msg").textContent = "enter a name");
  const next = { name, description: $("bd-desc").value.trim(), status: $("bd-status").value };
  try {
    if (!editing) await model.add(next);
    else if (editing.status !== next.status) {
      await model.update(editing.id, { name, description: next.description });
      await model.move(editing.id, next.status);
    } else await model.update(editing.id, next);
    $("bd-task").close();
  } catch (err) {
    $("bd-task-msg").textContent = err.message;
  }
}

/* ---------- app ---------- */

export default {
  id: "board",
  name: "Board",
  what: "task board",
  icon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M5 3h22v26H5z"/><path stroke="#fff" stroke-width="2.4" d="M10 9v14M16 9v9M22 9v5"/></svg>`,

  init() {
    for (const s of model.STATUSES) $("bd-status").append(new Option(model.STATUS_NAMES[s], s));
    $("bd-new").addEventListener("click", () => openTask(null));
    $("bd-task-form").addEventListener("submit", saveTask);
    $("bd-desc").addEventListener("keydown", (e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && saveTask(e));
    $("bd-task-cancel").addEventListener("click", () => $("bd-task").close());
    $("bd-task-x").addEventListener("click", () => $("bd-task").close());
    $("bd-del").addEventListener("click", async () => {
      if (!confirm(`Delete "${editing.name}"?`)) return;
      try {
        await model.remove(editing.id);
        $("bd-task").close();
      } catch (err) {
        $("bd-task-msg").textContent = err.message;
      }
    });
    $("bd-toast-x").addEventListener("click", () => ($("bd-toast").hidden = true));
    model.subscribe(render);
  },

  start: () => model.start(),

  show() {},
};
