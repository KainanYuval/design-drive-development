#!/usr/bin/env node
/**
 * Design visual iteration loop: capture → score → (optional SDK agent patch) → repeat.
 *
 * Usage:
 *   node scripts/design-visual-iterate.mjs [--diagram architecture.excalidraw] [--max-iterations 3] [--target-score 80]
 *
 * Requires playwright (`npx playwright install chromium` once).
 * Optional: CURSOR_API_KEY + `@cursor/sdk` for agent-driven patches between iterations.
 *
 * Artifacts: project/experiments/design-visual-iteration/<variant>/
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDiagram } from "./evaluate-diagram-visual.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const experimentRoot = join(repoRoot, "project", "experiments", "design-visual-iteration");

const SKILL_PATH = join(repoRoot, ".cursor/skills/design-drive-development/design-visual-iteration.md");
const DDD_SKILL_PATH = join(repoRoot, ".cursor/skills/design-drive-development/SKILL.md");

function parseArgs(argv) {
  let diagram = join(repoRoot, "architecture.excalidraw");
  let maxIterations = 3;
  let minIterations = 1;
  let targetScore = 80;
  let useAgent = Boolean(process.env.CURSOR_API_KEY);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--diagram") {
      diagram = resolve(argv[++i]);
      continue;
    }
    if (arg === "--max-iterations") {
      maxIterations = Number(argv[++i]);
      continue;
    }
    if (arg === "--min-iterations") {
      minIterations = Number(argv[++i]);
      continue;
    }
    if (arg === "--target-score") {
      targetScore = Number(argv[++i]);
      continue;
    }
    if (arg === "--no-agent") {
      useAgent = false;
      continue;
    }
    if (arg === "--agent") {
      useAgent = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { diagram, maxIterations, minIterations, targetScore, useAgent };
}

async function saveVariantDir(variant, diagramPath, iterationMeta) {
  const dir = join(experimentRoot, variant);
  await mkdir(dir, { recursive: true });
  const destDiagram = join(dir, "diagram.excalidraw");
  await copyFile(diagramPath, destDiagram);
  return {
    dir,
    destDiagram,
    png: join(dir, "preview.png"),
    scoreJson: join(dir, "score.json"),
    reviewMd: join(dir, "review.md"),
  };
}

async function writeGalleryIndex(entries) {
  const lines = [
    "# Design visual iteration gallery",
    "",
    "Programmatic captures and rubric scores for DDD diagram variants.",
    "",
    "| Variant | Score | Pass | Preview | Review |",
    "| --- | ---: | :---: | --- | --- |",
  ];

  for (const e of entries) {
    const rel = (p) => p.replace(repoRoot + "/", "");
    lines.push(
      `| ${e.variant} | ${e.score} | ${e.pass ? "yes" : "no"} | [preview](${rel(e.png)}) | [review](${rel(e.reviewMd)}) |`
    );
  }

  lines.push("", "## Run again", "", "```bash", "node scripts/design-visual-iterate.mjs --max-iterations 3", "```", "");
  await writeFile(join(experimentRoot, "index.md"), lines.join("\n"), "utf8");
}

function buildAgentPrompt({ variant, scorePayload, diagramPath, iteration }) {
  return `You are running design visual iteration ${iteration} for Design Drive Development.

Read and follow:
- ${DDD_SKILL_PATH}
- ${SKILL_PATH}

Target diagram on disk: ${diagramPath}
Current variant: ${variant}
Rubric score: ${scorePayload.score}/100 (pass=${scorePayload.pass})

Issues to fix (priority order):
${scorePayload.issues.map((i) => `- ${i}`).join("\n") || "- Polish layout, alignment, and arrow routing."}

Rules:
1. Patch ONLY the .excalidraw JSON on disk (minimal edits).
2. Keep legend-panel upper-left; do not delete semantic element ids.
3. Improve horizontal flow left→right; avoid crossing arrows.
4. After edits, do NOT commit unless asked.

When done, reply with a one-line summary of visual changes.`;
}

async function invokeCursorAgent(prompt, cwd) {
  if (!process.env.CURSOR_API_KEY) {
    return { skipped: true, reason: "CURSOR_API_KEY not set" };
  }

  try {
    const { Agent } = await import("@cursor/sdk");
    const result = await Agent.prompt(prompt, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: { cwd },
    });
    return { skipped: false, status: result.status, result: result.result };
  } catch (err) {
    return { skipped: false, error: String(err.message ?? err) };
  }
}

function clusterByY(boxes, tolerance) {
  const bands = [];
  for (const box of boxes) {
    const y = box.y ?? 0;
    let band = bands.find((b) => Math.abs(b[0].y - y) <= tolerance);
    if (!band) {
      band = [];
      bands.push(band);
    }
    band.push(box);
  }
  return bands;
}

async function applyHeuristicPatch(diagramPath, _scorePayload) {
  const raw = await readFile(diagramPath, "utf8");
  const doc = JSON.parse(raw);
  const elements = doc.elements ?? [];
  let changed = false;

  const mainBoxes = elements.filter(
    (e) =>
      e.type === "rectangle" &&
      e.id !== "legend-panel" &&
      !e.groupIds?.includes("legend") &&
      (e.width ?? 0) > 80 &&
      (e.x ?? 0) >= 280
  );

  if (mainBoxes.length >= 2) {
    const bands = clusterByY(mainBoxes, 80);
    for (const band of bands) {
      if (band.length < 2) {
        continue;
      }
      const targetY = Math.round(band.reduce((s, b) => s + (b.y ?? 0), 0) / band.length);
      for (const box of band) {
        if (Math.abs((box.y ?? 0) - targetY) > 4) {
          box.y = targetY;
          changed = true;
        }
      }
      band.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      let cursorX = band[0].x ?? 300;
      const gap = 48;
      for (const box of band) {
        if ((box.x ?? 0) < cursorX) {
          box.x = cursorX;
          changed = true;
        }
        cursorX = (box.x ?? 0) + (box.width ?? 160) + gap;
      }
    }
  }

  const legendPanel = elements.find((e) => e.id === "legend-panel");
  if (legendPanel && ((legendPanel.x ?? 0) > 40 || (legendPanel.y ?? 0) > 40)) {
    legendPanel.x = 24;
    legendPanel.y = 24;
    changed = true;
  }

  if (!changed) {
    return { applied: false };
  }

  await writeFile(diagramPath, JSON.stringify(doc, null, 2), "utf8");
  return { applied: true, note: "Heuristic lane align + spacing pass" };
}

export async function runDesignVisualIteration(options) {
  await mkdir(experimentRoot, { recursive: true });

  const gallery = [];
  let currentDiagram = options.diagram;
  let iteration = 0;

  while (iteration <= options.maxIterations) {
    const variant = iteration === 0 ? "v0-baseline" : `v${iteration}-iter`;
    const paths = await saveVariantDir(variant, currentDiagram, { iteration });

    const scorePayload = await evaluateDiagram({
      diagramPath: paths.destDiagram,
      png: paths.png,
      jsonOut: paths.scoreJson,
      reviewOut: paths.reviewMd,
      variant,
      capture: true,
    });

    gallery.push({
      variant,
      score: scorePayload.score,
      pass: scorePayload.pass,
      png: paths.png,
      reviewMd: paths.reviewMd,
      diagram: paths.destDiagram,
    });

    if (scorePayload.pass && scorePayload.score >= options.targetScore && iteration >= options.minIterations) {
      break;
    }
    if (iteration >= options.maxIterations) {
      break;
    }

    iteration += 1;
    const workingCopy = join(experimentRoot, `.working-v${iteration}.excalidraw`);
    await copyFile(paths.destDiagram, workingCopy);
    currentDiagram = workingCopy;

    const prompt = buildAgentPrompt({
      variant: `v${iteration}-iter`,
      scorePayload,
      diagramPath: workingCopy,
      iteration,
    });

    let patchResult;
    if (options.useAgent) {
      patchResult = await invokeCursorAgent(prompt, repoRoot);
    }
    if (!patchResult || patchResult.skipped || patchResult.error) {
      patchResult = await applyHeuristicPatch(workingCopy, scorePayload);
    }

    const metaDir = join(experimentRoot, `_patch-v${iteration}`);
    await mkdir(metaDir, { recursive: true });
    await writeFile(
      join(metaDir, "agent-meta.json"),
      JSON.stringify({ prompt, patchResult }, null, 2),
      "utf8"
    );
  }

  await writeGalleryIndex(gallery);
  return { gallery, experimentRoot };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDesignVisualIteration(args);
  console.log(JSON.stringify({ experimentRoot: result.experimentRoot, variants: result.gallery.map((g) => ({ variant: g.variant, score: g.score, pass: g.pass })) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
