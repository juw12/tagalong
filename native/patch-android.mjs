// Keeps the Android status bar a separate bar above the app (Android 15 and newer draw apps under it by default).
// Run after `npx cap add android`:  node patch-android.mjs [path to styles.xml]
// The web app also pads itself with CSS safe-area insets, so this is the second of two guards.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, "android", "app", "src", "main", "res", "values", "styles.xml");
const optOut = '<item name="android:windowOptOutEdgeToEdgeEnforcement" tools:targetApi="35">true</item>';

let xml = readFileSync(target, "utf8");
if (!xml.includes("xmlns:tools=")) {
  xml = xml.replace(/<resources(\s|>)/, '<resources xmlns:tools="http://schemas.android.com/tools"$1');
}

let patched = 0;
let already = 0;
xml = xml.replace(/(<style\s+name="AppTheme[^"]*"[^>]*>)([\s\S]*?)(\s*<\/style>)/g, (whole, open, body, close) => {
  if (body.includes("windowOptOutEdgeToEdgeEnforcement")) {
    already += 1;
    return whole;
  }
  patched += 1;
  return `${open}${body}\n        ${optOut}${close}`;
});

if (patched + already === 0) {
  console.error("no AppTheme style found in", target);
  process.exit(1);
}
writeFileSync(target, xml);
console.log(`edge-to-edge opt-out: ${patched} theme(s) patched, ${already} already set, in ${target}`);
