#!/usr/bin/env node
/**
 * Score a diagram JSON (+ optional PNG capture) against the DDD visual rubric.
 *
 * Usage:
 *   node scripts/evaluate-diagram-visual.mjs <diagram.excalidraw> [--png preview.png] [--json-out score.json] [--review-out review.md]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDiagram, sampleCanvasPixels } from "./capture-diagram.mjs";
import { chromium } from "playwright";
import {
  scoreDiagramJson,
  formatReviewMarkdown,
} from "./lib/diagram-visual-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const positional = [];
  let png = null;
  let jsonOut = null;
  let reviewOut = null;
  let variant = "variant";
  let capture = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--png") {
      png = resolve(argv[++i]);
      continue;
    }
    if (arg === "--json-out") {
      jsonOut = resolve(argv[++i]);
      continue;
    }
    if (arg === "--review-out") {
      reviewOut = resolve(argv[++i]);
      continue;
    }
    if (arg === "--variant") {
      variant = argv[++i];
      continue;
    }
    if (arg === "--capture") {
      capture = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    console.error("Usage: node scripts/evaluate-diagram-visual.mjs <diagram.excalidraw> [options]");
    process.exit(1);
  }

  return {
    diagramPath: resolve(positional[0]),
    png,
    jsonOut,
    reviewOut,
    variant,
    capture,
  };
}

export async function evaluateDiagram(options) {
  const raw = await readFile(options.diagramPath, "utf8");
  const doc = JSON.parse(raw);

  let pixelStats = null;
  let pngPath = options.png;

  if (options.capture || !pngPath) {
    pngPath = pngPath ?? options.diagramPath.replace(/\.excalidraw$/, ".png");
    const captured = await captureDiagram({
      diagramPath: options.diagramPath,
      out: pngPath,
    });
    pixelStats = captured.pixelStats;
  } else if (pngPath) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage();
      const html = `<html><body style="margin:0"><img id="img" src="file://${pngPath}" /></body></html>`;
      await page.setContent(html);
      await page.waitForSelector("#img");
      pixelStats = await page.evaluate(async () => {
        const img = document.getElementById("img");
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const w = c.width;
        const h = c.height;
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
      await context.close();
    } finally {
      await browser.close();
    }
  }

  const scoreResult = scoreDiagramJson(doc, pixelStats);
  const payload = {
    variant: options.variant,
    diagramPath: options.diagramPath,
    pngPath,
    pixelStats,
    ...scoreResult,
  };

  if (options.jsonOut) {
    await mkdir(dirname(options.jsonOut), { recursive: true });
    await writeFile(options.jsonOut, JSON.stringify(payload, null, 2), "utf8");
  }

  if (options.reviewOut) {
    const md = formatReviewMarkdown({
      variant: options.variant,
      sourcePath: options.diagramPath,
      scoreResult,
      pngPath: pngPath ?? "(none)",
    });
    await mkdir(dirname(options.reviewOut), { recursive: true });
    await writeFile(options.reviewOut, md, "utf8");
  }

  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await evaluateDiagram(args);
  console.log(JSON.stringify({ score: result.score, pass: result.pass, pngPath: result.pngPath }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
