/* the Tracker app: tiles that log events (a moment) or activities (a start and a finish, with a duration) */

import * as model from "./model.js";
import { $, el, fmtDuration, sortable } from "../../shared/util.js";

const pad = (n) => String(n).padStart(2, "0");
const hms = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const hm = (t) => hms(t).slice(0, 5);
const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const minuteOf = (t) => Math.floor(t / 60000);
const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
const DAY = 864e5;

let day = startOfDay(Date.now()); // the day the log shows
let shownMinute = 0; // the minute the log was drawn in: bars of running activities grow once a minute

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

/* every second: how long the running activities run (their tiles and log rows carry data-at, the start) */
function tick() {
  if ($("app-tracker").hidden || document.hidden) return;
  const now = Date.now();
  if (minuteOf(now) !== shownMinute && model.running().length) return renderLog();
  for (const n of document.querySelectorAll("#app-tracker [data-at]")) n.textContent = (n.dataset.prefix ?? "") + fmtDuration(now - Number(n.dataset.at));
}

/* ---------- tiles ---------- */

function renderTiles() {
  const box = $("tr-tiles");
  box.textContent = "";
  const now = Date.now();
  for (const t of model.activeTypes()) {
    const activity = t.kind === "activity";
    const run = activity ? model.running().find((e) => e.typeId === t.id) : null;
    const { count, last } = model.todayStat(t.id);
    const b = el("button", `tr-tile${run ? " running" : ""}`);
    b.type = "button";
    b.title = run ? `${t.name}: running since ${hm(run.at)}, Finish it in the log` : activity ? `${t.name}: starts an activity` : t.name;
    const meta = el("span", "tr-tile-meta", run ? `● ${fmtDuration(now - run.at)}` : count ? `today ×${count} · ${hm(last)}` : activity ? "▶ activity" : "today —");
    if (run) Object.assign(meta.dataset, { at: run.at, prefix: "● " });
    b.append(el("span", "tr-emoji", t.icon), el("span", "tr-tile-name", t.name), meta);
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
  if (t.kind === "activity" && model.isRunning(t.id)) return; // it runs: Finish is in the log
  node.classList.add("hit");
  setTimeout(() => node.classList.remove("hit"), 250);
  try {
    const e = await model.log(t.id);
    if (!e) return;
    toast(`${t.icon} ${t.name} ${e.endAt === null ? "started" : "logged"} · ${hm(e.at)}`, () => model.remove(e.id).catch(report));
  } catch (err) {
    report(err);
  }
}

/* ---------- log: the running activities on top (whatever day is shown), then the day's entries, newest first ---------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (d) => {
  const today = startOfDay(Date.now());
  const name = d === today ? "Today" : d === today - DAY ? "Yesterday" : WEEKDAYS[new Date(d).getDay()];
  return `${name} · ${ymd(d)}`;
};

function renderLog() {
  const now = Date.now();
  shownMinute = minuteOf(now);
  $("tr-day").textContent = dayName(day);
  $("tr-next").disabled = day >= startOfDay(now);
  const list = $("tr-log");
  list.textContent = "";
  const running = model.running().reverse();
  const entries = [...running, ...model.dayEntries(day).filter((e) => e.endAt !== null).reverse()];
  if (!entries.length) return list.append(el("div", "empty", "nothing logged"));
  // activity bars are as long as their duration, the longest one shown fills the column
  const longest = Math.max(1, ...entries.map((e) => (e.endAt === undefined ? 0 : (e.endAt ?? now) - e.at)));
  for (const e of entries) list.append(logRow(e, longest, now));
}

/* time of an entry that changes on click ("at" = the start, "endAt" = the end of an activity) */
function timeButton(e, field) {
  const b = el("button", "tr-time", hm(e[field]));
  b.title = `${ymd(e[field])} ${hm(e[field])}: click to change ${field === "at" ? (e.endAt === undefined ? "the time" : "when it started") : "when it finished"}`;
  b.addEventListener("click", () => openTime(e, field));
  return b;
}

/* start | end (Finish while it runs) | icon | name | duration bar (activities) | × */
function logRow(e, longest, now) {
  const type = model.typeById(e.typeId);
  const row = el("div", `tr-row${e.endAt === null ? " live" : ""}`);
  const end = el("span", "tr-end");
  const bar = el("span", "tr-len");
  if (e.endAt !== undefined) {
    const ms = (e.endAt ?? now) - e.at;
    if (e.endAt === null) {
      const done = el("button", "tr-finish primary", "Finish");
      done.title = "Finish it now";
      done.addEventListener("click", () =>
        model
          .finish(e.id)
          .then((f) => f && toast(`■ ${type?.name ?? "?"} finished · ${fmtDuration(f.endAt - f.at)}`, () => model.resume(f.id).catch(report)))
          .catch(report),
      );
      end.append(done);
      bar.classList.add("running");
    } else end.append(timeButton(e, "endAt"));
    const fill = el("i");
    fill.style.width = `${Math.max(0, Math.min(1, ms / longest)) * 100}%`;
    const text = el("span", "", fmtDuration(ms));
    if (e.endAt === null) text.dataset.at = e.at;
    bar.append(fill, text);
  }
  const del = el("button", "fdel", "×");
  del.title = "Delete this entry";
  del.addEventListener("click", () =>
    model
      .remove(e.id)
      .then((gone) => gone && toast(`Deleted ${type?.name ?? "entry"} · ${hm(e.at)}`, () => model.restore(gone).catch(report)))
      .catch(report),
  );
  const archived = type?.archivedAt != null;
  const what = el("span", `tr-what${type && !archived ? "" : " gone"}`, type?.name ?? "unknown type");
  if (archived) what.title = "archived type";
  const start = el("span", "tr-start");
  start.append(timeButton(e, "at"));
  row.append(start, end, el("span", "tr-emoji", type?.icon ?? "•"), what, bar, del);
  return row;
}

/* ---------- time editor: date YYYY-MM-DD and 24-hour time, whatever the locale ---------- */

let timing = null; // { e, field }

/* "2026-11-17" or "20261117"; "7:20", "07:20", "720", "0720", "7.20" -> local time in ms, NaN if it isn't one */
function parseTime(date, time) {
  const d = /^(\d{4})-?(\d{1,2})-?(\d{1,2})$/.exec(date.trim());
  const t = /^(\d{1,2})[:.]?(\d{2})$/.exec(time.trim());
  if (!d || !t) return NaN;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  const at = new Date(y, mo - 1, da, h, mi);
  return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === da && h < 24 && mi < 60 ? at.getTime() : NaN;
}

const timeMsg = (t) => ($("tr-time-msg").textContent = t);

function fillTime(t) {
  $("tr-time-date").value = ymd(t);
  $("tr-time-hm").value = hm(t);
}

function openTime(e, field) {
  timing = { e, field };
  const type = model.typeById(e.typeId);
  $("tr-time-title").textContent = `${type?.icon ?? "•"} ${type?.name ?? "unknown type"} · ${field === "endAt" ? "finish" : e.endAt === undefined ? "time" : "start"}`;
  fillTime(e[field]);
  timeMsg("");
  $("tr-time").showModal();
  // a phone would open its keyboard over the sheet: there the field is focused only when tapped
  if (!matchMedia("(pointer: coarse)").matches) $("tr-time-hm").select();
  else $("tr-time-form").querySelector("button[type=submit]").focus();
}

async function saveTime(ev) {
  ev.preventDefault();
  const { e, field } = timing;
  const time = parseTime($("tr-time-date").value, $("tr-time-hm").value);
  if (!Number.isFinite(time)) return timeMsg("date YYYY-MM-DD, time HH:MM (24 hours)");
  try {
    // an unchanged minute keeps the stored seconds
    if (minuteOf(time) !== minuteOf(e[field])) await model.setTime(e.id, field, time);
    $("tr-time").close();
  } catch (err) {
    timeMsg(err.message);
  }
}

/* −15 / −5 / now / +5 / +15 minutes from what the fields say */
function nudge(step) {
  const cur = parseTime($("tr-time-date").value, $("tr-time-hm").value);
  const base = Number.isFinite(cur) ? cur : timing.e[timing.field];
  fillTime(step === "now" ? Date.now() : base + Number(step) * 60000);
  timeMsg("");
}

/* ---------- new type dialog ---------- */

const SUGGESTED = [
  "🚬", "☕", "💧", "🍽️", "🍺", "💊", "☀️", "🌙", "💤", "🛁",
  "🏋️", "🚶", "🚴", "🏃", "🧘", "💻", "💼", "📖", "✍️", "🎧",
  "📞", "✉️", "💬", "🧹", "🛒", "🍳", "🐕", "🎮",
];

/* one emoji (a single grapheme: ☀️, 🏋️, 👷‍♀️, 🇩🇪…), not text */
const isEmoji = (s) => /^\p{RGI_Emoji}$/v.test(s) || /^\p{Extended_Pictographic}\uFE0F?$/u.test(s);
const PASTE_HINT = /Mac/.test(navigator.platform) ? "Ctrl+Cmd+Space" : /Win/.test(navigator.platform) ? "Win+." : "";

/* every emoji the browser knows that is a single code point (~1400), found by testing code points, so there is no
   emoji data to ship; grouped roughly by Unicode block. names aren't available, so there's no search */
const ALL_GROUPS = [
  ["Faces", [[0x1f600, 0x1f64f]]],
  ["Nature, food, places, objects", [[0x1f300, 0x1f5ff]]],
  ["Transport and map", [[0x1f680, 0x1f6ff]]],
  ["People, animals, food, objects (newer)", [[0x1f900, 0x1faff]]],
  ["Symbols", [[0x2000, 0x33ff], [0x1f000, 0x1f2ff], [0x1f780, 0x1f7ff]]],
];
const COMPONENT = (cp) => (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0x1f9b0 && cp <= 0x1f9b3); // skin tones, hair

function emojiAt(cp) {
  if (COMPONENT(cp)) return null;
  const s = String.fromCodePoint(cp);
  if (/^\p{RGI_Emoji}$/v.test(s)) return s;
  return /^\p{RGI_Emoji}$/v.test(s + "\uFE0F") ? s + "\uFE0F" : null; // ☀ -> ☀️
}

const pickButton = (em) => {
  const b = el("button", "", em);
  b.type = "button";
  b.dataset.emoji = em;
  return b;
};

/* built on first open */
function buildAll() {
  const box = $("tr-all");
  if (box.childElementCount) return;
  for (const [name, ranges] of ALL_GROUPS) {
    const grid = el("div", "tr-pick-grid");
    for (const [from, to] of ranges) for (let cp = from; cp <= to; cp++) {
      const em = emojiAt(cp);
      if (em) grid.append(pickButton(em));
    }
    box.append(el("div", "tr-all-head", name), grid);
  }
}

function toggleAll(open = $("tr-all").hidden) {
  if (open) buildAll();
  $("tr-all").hidden = !open;
  $("tr-all-btn").textContent = open ? "fewer emoji" : "all emoji…";
  $("tr-all-btn").setAttribute("aria-expanded", open);
  if (open) refreshNew();
}

const newIcon = () => $("tr-new-icon").value.trim();
const newMsg = (t) => ($("tr-new-msg").textContent = t);

/* preview tile, the note next to the icon box, the picked icon in the grid */
function refreshNew() {
  const icon = newIcon();
  const ok = isEmoji(icon);
  $("tr-prev-icon").textContent = ok ? icon : "?";
  $("tr-prev-icon").classList.toggle("none", !ok);
  $("tr-prev-name").textContent = $("tr-new-name").value.trim() || "Name";
  $("tr-icon-note").textContent = !icon
    ? `pick one below${PASTE_HINT ? `, or paste any emoji (${PASTE_HINT})` : ", or paste any emoji"}`
    : ok ? "" : "not an emoji: pick one below or paste one";
  $("tr-icon-note").classList.toggle("err", !!icon && !ok);
  for (const b of $("tr-new").querySelectorAll("[data-emoji]")) b.classList.toggle("on", b.dataset.emoji === icon);
}

function openNew() {
  $("tr-new-icon").value = "";
  $("tr-new-name").value = "";
  $("tr-new-form").elements["tr-kind"].value = "event";
  newMsg("");
  toggleAll(false);
  refreshNew();
  $("tr-new").showModal();
  $("tr-new-name").focus();
}

async function submitNew(e) {
  e.preventDefault();
  const name = $("tr-new-name").value.trim();
  const icon = newIcon();
  if (!name) {
    newMsg("enter a name");
    return $("tr-new-name").focus();
  }
  if (!isEmoji(icon)) return newMsg(icon ? "the icon must be one emoji" : "choose an icon");
  try {
    await model.addType({ name, icon, kind: $("tr-new-form").elements["tr-kind"].value });
    $("tr-new").close();
  } catch (err) {
    newMsg(err.message);
  }
}

/* ---------- types dialog (Types in the navigation) ---------- */

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
  const archived = t.archivedAt != null;
  const r = el("div", `tr-type-row${archived ? " archived" : ""}`);
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
  name.setAttribute("aria-label", "Name");
  name.addEventListener("input", () => (t.name = name.value));
  const check = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = t.kind === "activity";
  box.addEventListener("change", () => (t.kind = box.checked ? "activity" : "event"));
  check.title = "Has a start and a finish, shows its duration while running";
  check.append(box, "activity");
  // archive instead of delete: the tile goes away, the log keeps showing the type's name and icon
  const arch = el("button", "", archived ? "restore" : "archive");
  arch.title = archived ? "Show its tile again" : "Hide its tile; its entries stay in the log";
  arch.addEventListener("click", () => {
    t.archivedAt = archived ? null : Date.now();
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
  const bad = draft.findIndex((t) => !t.name.trim() || !isEmoji(t.icon));
  if (bad !== -1) return msg(`type ${bad + 1}: a name and one emoji as the icon are required`);
  try {
    await model.saveTypes(draft.map((t) => ({ ...t, name: t.name.trim() })));
    $("tr-types").close();
  } catch (e) {
    msg(e.message);
  }
}

/* every log entry goes (e.g. on a new device that got the types from a backup); the types stay */
async function clearLog() {
  const n = model.entryCount();
  if (!n) return ($("tr-types-msg").textContent = "the log is empty");
  if (!confirm(`Delete all ${n} log entries? The event types stay.`)) return;
  try {
    const gone = await model.clearEntries();
    $("tr-types").close();
    toast(`Deleted ${gone.length} log entries`, () => model.restore(gone).catch(report));
  } catch (e) {
    report(e);
  }
}

/* ---------- app ---------- */

function render() {
  renderTiles();
  renderLog();
}

export default {
  id: "tracker",
  name: "Tracker",
  what: "tracker",
  icon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M5 3h22v26H5z"/><path fill="none" stroke="#fff" stroke-width="2.4" d="M9 10l2 2 4-4M9 20l2 2 4-4M19 11h5M19 21h5"/></svg>`,

  init() {
    for (const em of SUGGESTED) $("tr-new-pick").append(pickButton(em));
    $("tr-new").addEventListener("click", (e) => {
      const b = e.target.closest("[data-emoji]");
      if (!b) return;
      $("tr-new-icon").value = b.dataset.emoji;
      newMsg("");
      refreshNew();
    });
    $("tr-all-btn").addEventListener("click", () => toggleAll());
    // the icon box keeps one emoji: typing or pasting a new one replaces the old
    $("tr-new-icon").addEventListener("input", () => {
      const parts = [...new Intl.Segmenter().segment($("tr-new-icon").value)].map((p) => p.segment);
      const last = parts.findLast(isEmoji);
      if (last && parts.length > 1) $("tr-new-icon").value = last;
      newMsg("");
      refreshNew();
    });
    $("tr-new-name").addEventListener("input", () => {
      newMsg("");
      refreshNew();
    });
    $("tr-new-form").addEventListener("submit", submitNew);
    $("tr-new-cancel").addEventListener("click", () => $("tr-new").close());
    $("tr-new-x").addEventListener("click", () => $("tr-new").close());
    $("tr-edit").addEventListener("click", openTypes);
    $("tr-types-x").addEventListener("click", () => $("tr-types").close());
    $("tr-types-cancel").addEventListener("click", () => $("tr-types").close());
    $("tr-types-save").addEventListener("click", saveTypes);
    $("tr-clear").addEventListener("click", clearLog);
    $("tr-time-form").addEventListener("submit", saveTime);
    $("tr-time-cancel").addEventListener("click", () => $("tr-time").close());
    $("tr-time-x").addEventListener("click", () => $("tr-time").close());
    $("tr-time-quick").addEventListener("click", (e) => e.target.dataset.min && nudge(e.target.dataset.min));
    $("tr-time").addEventListener("close", () => (timing = null));

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
    document.addEventListener("visibilitychange", () => !document.hidden && !$("app-tracker").hidden && render()); // "today" may have moved on
  },

  start: () => model.start(),

  show() {
    tick();
  },
};
