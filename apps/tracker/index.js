/* the Tracker app: tiles that log events (one-shot or activities with a duration) into the "tracker" subfolder */

import * as model from "./model.js";
import * as folder from "../../shared/folder.js";
import { $, el, fmtDuration, sortable } from "../../shared/util.js";

const pad = (n) => String(n).padStart(2, "0");
const hms = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const hm = (t) => hms(t).slice(0, 5);
/* value of <input type="datetime-local" step="1"> in local time */
const toInput = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hms(t)}`;
};
const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
const DAY = 864e5;

let day = startOfDay(Date.now()); // the day the log shows
let live = null; // running activities on screen: activity -> { dur, fill, start }

const report = (e) => toast(e?.message || String(e), null, "err");

/* ---------- undo toast ---------- */

let toastTimer = 0;
let undoFn = null;

function toast(text, undo = null, kind = "") {
  clearTimeout(toastTimer);
  undoFn = undo;
  $("tr-toast-text").textContent = text;
  $("tr-toast-undo").hidden = !undo;
  $("tr-toast").className = `tr-toast ${kind}`;
  $("tr-toast").hidden = false;
  toastTimer = setTimeout(() => ($("tr-toast").hidden = true), kind === "err" ? 8000 : 6000);
}

/* ---------- running activities ---------- */

const STEPS = [15, 30, 60, 120, 240, 480, 720, 1440].map((m) => m * 60000);
const scaleFor = (ms) => STEPS.find((s) => ms < s) ?? Math.ceil((ms + 1) / DAY) * DAY;
const fmtScale = (s) => (s >= DAY ? `${s / DAY}d` : s >= 36e5 ? `${s / 36e5}h` : `${s / 6e4}m`);

function renderSpans() {
  const box = $("tr-spans");
  const running = model.runningSpans();
  box.hidden = !running.length;
  box.textContent = "";
  live = new Map();
  for (const s of running) {
    const type = model.typeById(s.type);
    const row = el("div", "tr-span");
    const dur = el("span", "tr-dur");
    const fill = el("div", "tr-fill");
    const scale = el("span", "tr-scale");
    const done = el("button", "primary", "Finish");
    done.addEventListener("click", () =>
      model
        .finish(s.activity)
        .then((end) => end && toast(`■ ${type?.name ?? s.type} finished · ${fmtDuration(end.time - s.time)}`, () => model.remove(end.id).catch(report)))
        .catch(report),
    );
    const track = el("div", "tr-track");
    track.append(fill, scale);
    const name = el("span", "tr-sname", type?.name ?? s.type);
    name.append(el("small", "", `since ${hm(s.time)}`));
    row.append(el("span", "tr-emoji", type?.icon ?? "•"), name, dur, done, track);
    box.append(row);
    live.set(s.activity, { dur, fill, scale, start: s.time });
  }
  tick();
}

/* every second: durations and bars of the running activities */
function tick() {
  if (!live?.size || $("app-tracker").hidden || document.hidden) return;
  const now = Date.now();
  for (const { dur, fill, scale, start } of live.values()) {
    const ms = now - start;
    const s = scaleFor(ms);
    dur.textContent = fmtDuration(ms);
    fill.style.width = `${(ms / s) * 100}%`;
    scale.textContent = `scale ${fmtScale(s)}`;
  }
}

/* ---------- tiles ---------- */

function renderTiles() {
  const box = $("tr-tiles");
  box.textContent = "";
  for (const t of model.activeTypes()) {
    const running = t.span && model.isRunning(t.id);
    const { count, last } = model.todayStat(t.id);
    const b = el("button", `tr-tile${running ? " running" : ""}`);
    b.type = "button";
    b.title = t.span ? `${t.name}: starts an activity` : t.name;
    b.append(
      el("span", "tr-emoji", t.icon),
      el("span", "tr-tile-name", t.name),
      el("span", "tr-tile-meta", running ? "running…" : count ? `today ×${count} · ${hm(last)}` : t.span ? "▶ activity" : "today —"),
    );
    b.addEventListener("click", () => hit(t, b));
    box.append(b);
  }
  const add = el("button", "tr-tile add");
  add.type = "button";
  add.title = "New event type";
  add.append(el("span", "tr-emoji", "+"), el("span", "tr-tile-name", "new type"));
  add.addEventListener("click", openNew);
  box.append(add);
}

async function hit(t, node) {
  node.classList.add("hit");
  setTimeout(() => node.classList.remove("hit"), 250);
  try {
    const e = await model.log(t.id);
    if (!e) return;
    toast(`${t.icon} ${t.name} ${t.span ? "started" : "logged"} · ${hms(e.time)}`, () => model.remove(e.id).catch(report));
  } catch (err) {
    report(err);
  }
}

/* ---------- log ---------- */

const dayName = (d) => {
  const today = startOfDay(Date.now());
  if (d === today) return "Today";
  if (d === today - DAY) return "Yesterday";
  return new Date(d).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
};

function renderLog() {
  $("tr-day").textContent = dayName(day);
  $("tr-next").disabled = day >= startOfDay(Date.now());
  const list = $("tr-log");
  list.textContent = "";
  const events = model.dayEvents(day).reverse();
  if (!events.length) return list.append(el("div", "empty", "no events"));
  for (const e of events) list.append(logRow(e));
}

function logRow(e) {
  const type = model.typeById(e.type);
  const row = el("div", "tr-row");
  const time = el("button", "tr-time", hms(e.time));
  time.title = "Click to change the time";
  time.addEventListener("click", () => editTime(row, time, e));

  let note = "";
  if (e.phase === "start") note = model.spanLength(e) == null ? "start · running" : "start";
  if (e.phase === "end") {
    const start = model.getEvents().find((x) => x.activity === e.activity && x.phase === "start");
    note = start ? `end · ${fmtDuration(e.time - start.time)}` : "end";
  }
  const del = el("button", "fdel", "×");
  del.title = "Delete this event";
  del.addEventListener("click", () =>
    model
      .remove(e.id)
      .then((gone) => gone.length && toast(`Deleted ${type?.name ?? e.type} · ${hms(e.time)}${gone.length > 1 ? " (with its end)" : ""}`, () => model.restore(gone).catch(report)))
      .catch(report),
  );
  const what = el("span", `tr-what${type && !type.archived ? "" : " gone"}`, type?.name ?? `${e.type} (unknown type)`);
  if (type?.archived) what.title = "archived type";
  row.append(time, el("span", "tr-emoji", type?.icon ?? "•"), what, el("span", "tr-note", note), del);
  return row;
}

function editTime(row, button, e) {
  const input = el("input");
  input.type = "datetime-local";
  input.step = 1;
  input.value = toInput(e.time);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const time = new Date(input.value).getTime();
    if (save && Number.isFinite(time) && time !== e.time) model.setTime(e.id, time).catch(report).finally(renderLog);
    else renderLog();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") finish(true);
    if (ev.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  button.replaceWith(input);
  input.focus();
}

/* ---------- new type dialog ---------- */

const SUGGESTED = ["🚬", "🏋️", "☀️", "🌙", "📞", "💧", "🍽️", "☕", "💊", "🚶", "🧘", "📖", "🛁", "🚴", "🍺", "💤", "🧹", "🛒", "✉️", "🎮"];

function openNew() {
  $("tr-new-icon").value = "";
  $("tr-new-name").value = "";
  $("tr-new-span").checked = false;
  $("tr-new-msg").textContent = "";
  $("tr-new").showModal();
  $("tr-new-name").focus();
}

async function submitNew(e) {
  e.preventDefault();
  const name = $("tr-new-name").value.trim();
  const icon = $("tr-new-icon").value.trim();
  const msg = (t) => ($("tr-new-msg").textContent = t);
  if (!name) return msg("enter a name");
  if (!icon) return msg("pick or type an icon (an emoji)");
  try {
    await model.saveTypes([...model.getTypes(), { id: model.newTypeId(name), name, icon, span: $("tr-new-span").checked }]);
    $("tr-new").close();
  } catch (err) {
    msg(err.message);
  }
}

/* ---------- edit types dialog ---------- */

let draft = [];

function openTypes() {
  draft = structuredClone(model.getTypes());
  $("tr-types-msg").textContent = "";
  renderTypeRows();
  $("tr-types").showModal();
}

function renderTypeRows() {
  const rows = $("tr-types-rows");
  rows.textContent = "";
  if (!draft.length) rows.append(el("div", "empty", "no event types yet"));
  draft.forEach((t, i) => rows.append(typeRow(t, i)));
}

function typeRow(t, i) {
  const r = el("div", `tr-type-row${t.archived ? " archived" : ""}`);
  const handle = el("span", "drag-handle", "⋮⋮");
  handle.title = "Drag to reorder";
  const icon = el("input", "tr-icon-in");
  icon.type = "text";
  icon.maxLength = 8;
  icon.value = t.icon;
  icon.setAttribute("aria-label", "Icon");
  icon.addEventListener("input", () => (t.icon = icon.value.trim()));
  const name = el("input");
  name.type = "text";
  name.value = t.name;
  name.title = `id: ${t.id}`;
  name.setAttribute("aria-label", "Name");
  name.addEventListener("input", () => (t.name = name.value));
  const check = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = !!t.span;
  box.addEventListener("change", () => (t.span = box.checked));
  check.title = "Has a start and a finish, shows its duration while running";
  check.append(box, "activity");
  // archive instead of delete: the tile goes away, the log keeps showing the type's name and icon
  const arch = el("button", "", t.archived ? "restore" : "archive");
  arch.title = t.archived ? "Show its tile again" : "Hide its tile; its events stay in the log";
  arch.addEventListener("click", () => {
    if (t.archived) delete t.archived;
    else t.archived = true;
    renderTypeRows();
  });

  handle.addEventListener("mousedown", () => (r.draggable = true));
  sortable(r, {
    group: "tr-types",
    key: i,
    vertical: true,
    onDrop(from, to, after) {
      const [moved] = draft.splice(from, 1);
      let at = to + (after ? 1 : 0);
      if (from < at) at--;
      draft.splice(at, 0, moved);
      renderTypeRows();
    },
    onEnd: () => (r.draggable = false),
  });
  r.append(handle, icon, name, check, arch);
  return r;
}

async function saveTypes() {
  const msg = (t) => ($("tr-types-msg").textContent = t);
  const bad = draft.findIndex((t) => !t.name.trim() || !t.icon);
  if (bad !== -1) return msg(`type ${bad + 1}: name and icon are required`);
  try {
    await model.saveTypes(draft.map((t) => ({ ...t, name: t.name.trim() })));
    $("tr-types").close();
  } catch (e) {
    msg(e.message);
  }
}

/* ---------- app ---------- */

function render() {
  renderSpans();
  renderTiles();
  renderLog();
}

export default {
  id: "tracker",
  name: "Tracker",
  what: "tracker",
  needsFolder: true,
  icon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M5 3h22v26H5z"/><path fill="none" stroke="#fff" stroke-width="2.4" d="M9 10l2 2 4-4M9 20l2 2 4-4M19 11h5M19 21h5"/></svg>`,

  init() {
    const pick = $("tr-new-pick");
    for (const em of SUGGESTED) {
      const b = el("button", "", em);
      b.type = "button";
      b.addEventListener("click", () => {
        $("tr-new-icon").value = em;
        $("tr-new-name").focus();
      });
      pick.append(b);
    }
    $("tr-new-form").addEventListener("submit", submitNew);
    $("tr-new-cancel").addEventListener("click", () => $("tr-new").close());
    $("tr-new-x").addEventListener("click", () => $("tr-new").close());
    $("tr-edit").addEventListener("click", openTypes);
    $("tr-types-x").addEventListener("click", () => $("tr-types").close());
    $("tr-types-cancel").addEventListener("click", () => $("tr-types").close());
    $("tr-types-save").addEventListener("click", saveTypes);

    const go = (d) => {
      day = startOfDay(d);
      renderLog();
    };
    $("tr-prev").addEventListener("click", () => go(day - DAY / 2));
    $("tr-next").addEventListener("click", () => go(day + DAY * 1.5));
    $("tr-today").addEventListener("click", () => go(Date.now()));
    $("tr-toast-undo").addEventListener("click", () => {
      $("tr-toast").hidden = true;
      undoFn?.();
    });

    model.subscribe(render);
    setInterval(tick, 1000);
    document.addEventListener("visibilitychange", () => !document.hidden && !$("app-tracker").hidden && model.refresh());
  },

  async start() {
    await model.start();
    $("tr-dir").textContent = `${folder.getDir().name}/tracker`;
  },

  show() {
    model.refresh();
  },
};
