#!/usr/bin/env node
/**
 * Headless PNG capture of a .excalidraw file via the bundled DDD webview.
 *
 * Usage:
 *   node scripts/capture-diagram.mjs <diagram.excalidraw> [--out preview.png] [--width 1600] [--height 1000]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { contentBoundingBox } from "./lib/diagram-visual-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const viewerDist = join(repoRoot, "viewer", "dist");

function usage() {
  console.log(`Usage: node scripts/capture-diagram.mjs <diagram.excalidraw> [--out path.png] [--width N] [--height N]`);
}

function parseArgs(argv) {
  const positional = [];
  let out = null;
  let width = 1600;
  let height = 1000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      out = argv[++i];
      continue;
    }
    if (arg === "--width") {
      width = Number(argv[++i]);
      continue;
    }
    if (arg === "--height") {
      height = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    usage();
    process.exit(1);
  }

  const diagramPath = resolve(positional[0]);
  if (!out) {
    out = diagramPath.replace(/\.excalidraw$/, ".png");
  } else {
    out = resolve(out);
  }

  return { diagramPath, out, width, height };
}

async function buildCapturePage(diagramPath, content) {
  const captureDir = join(here, ".capture-cache");
  await mkdir(captureDir, { recursive: true });

  const doc = JSON.parse(content);
  const bbox = contentBoundingBox(doc.elements ?? []);
  const pad = 40;
  let width = 1200;
  let height = 680;

  if (bbox && bbox.width > 0 && bbox.height > 0) {
    width = Math.min(1280, Math.max(760, Math.ceil(bbox.width + pad * 2)));
    height = Math.min(860, Math.max(520, Math.ceil(bbox.height + pad * 2)));
    const zoom = Math.min((width - pad * 2) / bbox.width, (height - pad * 2) / bbox.height, 1.35);
    doc.appState = {
      ...(doc.appState ?? {}),
      zenModeEnabled: true,
      viewModeEnabled: true,
      viewBackgroundColor: "#ffffff",
      zoom: { value: zoom },
      scrollX: -(bbox.minX - pad) * zoom,
      scrollY: -(bbox.minY - pad) * zoom,
    };
  } else {
    doc.appState = {
      ...(doc.appState ?? {}),
      zenModeEnabled: true,
      viewModeEnabled: true,
      viewBackgroundColor: "#ffffff",
    };
  }

  const inject = JSON.stringify({ path: diagramPath, content: JSON.stringify(doc) });
  const webviewJs = pathToFileURL(join(viewerDist, "webview.js")).href;
  const webviewCss = pathToFileURL(join(viewerDist, "webview.css")).href;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="${webviewCss}" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #fff; }
    #root { width: 100%; height: 100%; }
    .excalidraw .App-toolbar,
    .excalidraw .layer-ui__wrapper,
    .excalidraw .App-menu,
    .excalidraw .App-bottom-bar,
    .excalidraw .mobile-misc-tools-container,
    .excalidraw button[title*="zen"],
    .excalidraw .reset-zoom-button,
    .excalidraw .zoom-actions { display: none !important; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__DDD_APPLET__ = true;
    window.__DDD_INITIAL_DIAGRAM__ = ${inject};
  </script>
  <script defer src="${webviewJs}"></script>
</body>
</html>`;

  const pagePath = join(captureDir, "capture.html");
  await writeFile(pagePath, html, "utf8");
  return { pagePath, width, height };
}

export async function sampleCanvasPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".excalidraw canvas");
    if (!canvas) {
      return null;
    }
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    const { data } = ctx.getImageData(0, 0, w, h);

    let nonWhite = 0;
    let legendInk = 0;
    const legendW = Math.floor(w * 0.22);
    const legendH = Math.floor(h * 0.35);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        const isWhite = a < 8 || (r > 250 && g > 250 && b > 250);
        if (!isWhite) {
          nonWhite++;
          if (x < legendW && y < legendH) {
            legendInk++;
          }
        }
      }
    }

    const total = w * h;
    return {
      width: w,
      height: h,
      nonWhiteRatio: nonWhite / total,
      legendRegionInk: legendInk / (legendW * legendH),
    };
  });
}

export async function captureDiagram({ diagramPath, out, width: widthIn, height: heightIn, browser }) {
  const raw = await readFile(diagramPath, "utf8");
  JSON.parse(raw);

  const { pagePath, width, height } = await buildCapturePage(diagramPath, raw);
  const viewportW = widthIn ?? width;
  const viewportH = heightIn ?? height;
  const ownBrowser = browser ?? (await chromium.launch({ headless: true }));
  const closeBrowser = !browser;

  try {
    const context = await ownBrowser.newContext({ viewport: { width: viewportW, height: viewportH } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "networkidle" });

    await page.waitForSelector(".excalidraw canvas", { timeout: 45000 });
    await page.waitForTimeout(800);

    await mkdir(dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: "png" });

    const pixelStats = await sampleCanvasPixels(page);
    await context.close();

    return { out, pixelStats };
  } finally {
    if (closeBrowser) {
      await ownBrowser.close();
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await captureDiagram(args);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
