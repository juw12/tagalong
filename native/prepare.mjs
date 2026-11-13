// Copies the web app into native/www so Capacitor can wrap it. Tests, tools and hone files are left out.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const www = join(here, "www");
const files = [
  "index.html", "styles.css", "app.js", "core.js", "live.js", "world.js", "sw.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const file of files) cpSync(join(root, file), join(www, file));
cpSync(join(root, "vendor"), join(www, "vendor"), { recursive: true });
console.log("copied", files.length, "files and vendor/ into", www);
