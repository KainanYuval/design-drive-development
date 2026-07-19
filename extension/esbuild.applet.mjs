import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mediaDir = join(process.cwd(), "media");
const viewerDist = join(process.cwd(), "..", "viewer", "dist");

mkdirSync(viewerDist, { recursive: true });

for (const file of readdirSync(mediaDir)) {
  if (
    file === "webview.js" ||
    file === "webview.css" ||
    file.endsWith(".woff2") ||
    file === "webview.js.map" ||
    file === "webview.css.map"
  ) {
    cpSync(join(mediaDir, file), join(viewerDist, file), { force: true });
  }
}

console.log(`Applet assets copied to ${viewerDist}`);
