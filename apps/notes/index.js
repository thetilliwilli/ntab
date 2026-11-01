/* the Notes app: a tabbed plain-text notepad over the "notes" subfolder of the data folder */

import * as notes from "./notes.js";
import * as editor from "./editor.js";
import { initTabbar } from "./tabbar.js";
import { initFilesDialog, initClosePanel, showInlineFiles } from "./dialogs.js";
import { getSettings, updateSettings, subscribeSettings } from "../../shared/settings.js";
import { $ } from "../../shared/util.js";

let ready = false; // notes.start() has run on the current folder

/* editor (open tabs) / empty state with the file list (no open tabs) */
function updateView() {
  const none = !notes.getOrder().length;
  const wasHidden = $("nothing").hidden;
  $("editor").hidden = !ready || none;
  $("nothing").hidden = !ready || !none;
  if (wasHidden && !$("nothing").hidden) showInlineFiles();
  $("tab-add").disabled = !ready;
}

function applySettings(s) {
  editor.configure(s);
  $("font-size").textContent = s.fontSize;
  $("wrap").classList.toggle("on", s.wrap);
  $("wrap").setAttribute("aria-pressed", s.wrap);
  $("tab-size").value = s.tabSize;
}

export default {
  id: "notes",
  name: "Notes",
  what: "notepad",
  needsFolder: true,
  icon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M5 3h22v26H5z"/><path stroke="#fff" stroke-width="2.4" d="M10 10h12M10 15.5h12M10 21h7"/></svg>`,

  init(ctx) {
    const cfg = getSettings;
    $("font-dec").addEventListener("click", () => updateSettings({ fontSize: Math.max(9, cfg().fontSize - 1) }));
    $("font-inc").addEventListener("click", () => updateSettings({ fontSize: Math.min(32, cfg().fontSize + 1) }));
    $("wrap").addEventListener("click", () => updateSettings({ wrap: !cfg().wrap }));
    $("tab-size").addEventListener("change", (e) => updateSettings({ tabSize: Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 4)) }));

    editor.init({
      onInput: notes.onEdit,
      onScroll: notes.onScroll,
      onCursor({ ln, col, len, sel }) {
        $("st-pos").textContent = `Ln ${ln}, Col ${col}${sel ? ` (${sel} sel)` : ""}`;
        $("st-len").textContent = `${len} chars`;
      },
    });
    notes.onStatus((text, kind) => {
      const s = $("st-save");
      s.textContent = text;
      s.dataset.kind = kind;
    });
    notes.subscribe(updateView);

    initTabbar();
    initClosePanel();
    initFilesDialog({ onChangeFolder: () => ctx.changeFolder().catch((e) => e?.name !== "AbortError" && notes.report(e?.message || String(e))) });
    subscribeSettings(applySettings);
    applySettings(getSettings());
    updateView();
  },

  async start(opts) {
    ready = true;
    await notes.start(opts);
    updateView();
  },

  show() {
    if (ready && notes.getOrder().length) editor.focus();
    else if (ready) $("nothing-filter").focus();
  },

  flush: () => notes.flushAll(),
};
