/* turning a user's image file, or a cached favicon, into an icon stored in the action (actions editor, action form) */

import { loadImg } from "./actions.js";

const ICON_SIZE = 128; // uploaded icons are drawn up to 56px on the home tiles

const picker = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });

export function pickFile() {
  return new Promise((resolve) => {
    picker.value = "";
    picker.onchange = () => resolve(picker.files[0] || null);
    picker.click();
  });
}

/* any image the browser can decode (png, ico, svg, jpg…) -> ICON_SIZE square PNG data URL; throws if unreadable */
export async function iconFromFile(file) {
  const obj = URL.createObjectURL(file);
  try {
    return iconFromImage(await loadImg(obj));
  } finally {
    URL.revokeObjectURL(obj);
  }
}

/* a loaded image (same origin, e.g. the favicon cache) -> ICON_SIZE square PNG data URL */
export function iconFromImage(img) {
  const c = document.createElement("canvas");
  c.width = c.height = ICON_SIZE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
  return c.toDataURL("image/png");
}
