/* the Tracker app: tiles that log events (a moment) or activities (a start and a finish, with a duration) */

import * as model from "./model.js";
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
let live = null; // running activities on screen: entry id -> { dur, fill, scale, start }

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
  const running = model.running();
  box.hidden = !running.length;
  box.textContent = "";
  live = new Map();
  for (const s of running) {
    const type = model.typeById(s.typeId);
    const row = el("div", "tr-span");
    const dur = el("span", "tr-dur");
    const fill = el("div", "tr-fill");
    const scale = el("span", "tr-scale");
    const done = el("button", "primary", "Finish");
    done.addEventListener("click", () =>
      model
        .finish(s.id)
        .then((e) => e && toast(`■ ${type?.name ?? "?"} finished · ${fmtDuration(e.endAt - e.at)}`, () => model.resume(e.id).catch(report)))
        .catch(report),
    );
    const track = el("div", "tr-track");
    track.append(fill, scale);
    const name = el("span", "tr-sname", type?.name ?? "unknown type");
    name.append(el("small", "", `since ${hm(s.at)}`));
    row.append(el("span", "tr-emoji", type?.icon ?? "•"), name, dur, done, track);
    box.append(row);
    live.set(s.id, { dur, fill, scale, start: s.at });
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
  for (const bar of document.querySelectorAll(".tr-len.running span")) bar.textContent = fmtDuration(now - Number(bar.dataset.at));
}

/* ---------- tiles ---------- */

function renderTiles() {
  const box = $("tr-tiles");
  box.textContent = "";
  for (const t of model.activeTypes()) {
    const activity = t.kind === "activity";
    const running = activity && model.isRunning(t.id);
    const { count, last } = model.todayStat(t.id);
    const b = el("button", `tr-tile${running ? " running" : ""}`);
    b.type = "button";
    b.title = activity ? `${t.name}: starts an activity` : t.name;
    b.append(
      el("span", "tr-emoji", t.icon),
      el("span", "tr-tile-name", t.name),
      el("span", "tr-tile-meta", running ? "running…" : count ? `today ×${count} · ${hm(last)}` : activity ? "▶ activity" : "today —"),
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
    toast(`${t.icon} ${t.name} ${e.endAt === null ? "started" : "logged"} · ${hms(e.at)}`, () => model.remove(e.id).catch(report));
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
  const entries = model.dayEntries(day).reverse();
  if (!entries.length) return list.append(el("div", "empty", "nothing logged"));
  // activity bars are as long as their duration, the day's longest fills the column
  const now = Date.now();
  const longest = Math.max(1, ...entries.map((e) => (e.endAt === undefined ? 0 : (e.endAt ?? now) - e.at)));
  for (const e of entries) list.append(logRow(e, longest, now));
}

/* time of an entry that changes on click ("at" = the start, "endAt" = the end of an activity) */
function timeButton(e, field) {
  const b = el("button", "tr-time", hms(e[field]));
  b.title = field === "at" ? "Click to change the time" : "Click to change when it finished";
  b.addEventListener("click", () => editTime(b, e, field));
  return b;
}

/* start | end | icon | name | duration bar (activities) | × */
function logRow(e, longest, now) {
  const type = model.typeById(e.typeId);
  const row = el("div", "tr-row");
  const end = el("span", "tr-end");
  const bar = el("span", "tr-len");
  if (e.endAt !== undefined) {
    const ms = (e.endAt ?? now) - e.at;
    if (e.endAt === null) {
      end.append(el("span", "tr-running", "running"));
      bar.classList.add("running");
    } else end.append(timeButton(e, "endAt"));
    const fill = el("i");
    fill.style.width = `${Math.max(0, Math.min(1, ms / longest)) * 100}%`;
    const text = el("span", "", fmtDuration(ms));
    text.dataset.at = e.at;
    bar.append(fill, text);
  }
  const del = el("button", "fdel", "×");
  del.title = "Delete this entry";
  del.addEventListener("click", () =>
    model
      .remove(e.id)
      .then((gone) => gone && toast(`Deleted ${type?.name ?? "entry"} · ${hms(e.at)}`, () => model.restore(gone).catch(report)))
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

function editTime(button, e, field) {
  const input = el("input");
  input.type = "datetime-local";
  input.step = 1;
  input.value = toInput(e[field]);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const time = new Date(input.value).getTime();
    if (save && Number.isFinite(time) && time !== e[field]) model.setTime(e.id, field, time).catch(report).finally(renderLog);
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
