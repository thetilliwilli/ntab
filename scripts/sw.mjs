/* writes VERSION (a hash of the files) and FILES (what the web version needs) into sw.js.
   run: node scripts/sw.mjs   (--check: exit 1 if sw.js is stale, changes nothing) */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const DIRS = ["platform", "shared", "shell", "apps", "icons"];
// the extension's own files: never loaded by the web page
const SKIP = new Set(["platform/extension.js", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"]);

const walk = (d) =>
  fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

const files = ["index.html", "newtab.html", "manifest.webmanifest", ...DIRS.flatMap(walk).filter((f) => !SKIP.has(f)).sort()];
const hash = crypto.createHash("sha256");
for (const f of files) hash.update(f + "\0").update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest("hex").slice(0, 12);

const block = `// generated: start\nconst VERSION = "${version}";\nconst FILES = [\n  "./",\n${files.map((f) => `  "${f}",`).join("\n")}\n];\n// generated: end`;
const swPath = path.join(ROOT, "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
const next = sw.replace(/\/\/ generated: start[\s\S]*?\/\/ generated: end/, block);

if (process.argv.includes("--check")) {
  if (next !== sw) {
    console.error("sw.js is stale: run node scripts/sw.mjs");
    process.exit(1);
  }
  console.log(`sw.js is up to date (${version})`);
} else {
  fs.writeFileSync(swPath, next);
  console.log(`sw.js: version ${version}, ${files.length} files`);
}
