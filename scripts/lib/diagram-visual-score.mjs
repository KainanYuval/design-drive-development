/**
 * Comprehensibility-focused rubric for DDD architecture diagrams.
 * Penalizes crossing arrows, fan-out mess, missing swimlanes, poor framing.
 */

const LEGEND_IDS = new Set(["legend-panel", "legend-h"]);

export function scoreDiagramJson(doc, pixelStats = null) {
  const elements = (doc.elements ?? []).filter((e) => !e.isDeleted);
  const issues = [];
  const checks = [];

  const legendPanel = elements.find((e) => e.id === "legend-panel");
  const legendHeader = elements.find((e) => e.id === "legend-h");
  const legendSwatches = elements.filter(
    (e) => e.groupIds?.includes("legend") && e.type === "rectangle" && e.id !== "legend-panel"
  );

  if (legendPanel && legendHeader && legendSwatches.length >= 4) {
    checks.push({ id: "legend-complete", pass: true, weight: 8 });
  } else {
    checks.push({ id: "legend-complete", pass: false, weight: 8 });
    issues.push("Legend incomplete — need panel, heading, and ≥4 color swatch rows.");
  }

  const boxes = elements.filter(
    (e) =>
      e.type === "rectangle" &&
      !LEGEND_IDS.has(e.id) &&
      !e.groupIds?.includes("legend") &&
      !e.groupIds?.includes("swimlane") &&
      (e.width ?? 0) > 80
  );
  const arrows = elements.filter((e) => e.type === "arrow" && !e.isDeleted);
  const texts = elements.filter((e) => e.type === "text" && !e.groupIds?.includes("legend"));

  const swimlaneBgs = elements.filter(
    (e) => e.groupIds?.includes("swimlane") || String(e.id).startsWith("lane-")
  );
  const swimlaneLabels = texts.filter(
    (e) => e.groupIds?.includes("swimlane") || String(e.id).startsWith("lane-label")
  );

  checks.push({
    id: "swimlanes",
    pass: swimlaneBgs.length >= 3 && swimlaneLabels.length >= 3,
    weight: 14,
    detail: `${swimlaneBgs.length} lanes, ${swimlaneLabels.length} labels`,
  });
  if (!checks.at(-1).pass) {
    issues.push("Missing swimlanes — add labeled horizontal lanes so the story reads top→bottom.");
  }

  const mainBoxes = boxes.filter((b) => (b.x ?? 0) >= 280);
  const bbox = contentBoundingBox(elements);

  checks.push({
    id: "primary-flow-left-to-right",
    pass: swimlaneBgs.length >= 3 || scoreLeftToRightFlow(mainBoxes),
    weight: 10,
    detail: swimlaneBgs.length >= 3 ? "vertical swimlane flow" : undefined,
  });
  if (!checks.at(-1).pass) {
    issues.push("Top authoring row should read left→right (Authors before file on disk).");
  }

  const crossings = countArrowCrossings(arrows);
  checks.push({
    id: "no-arrow-crossings",
    pass: crossings === 0,
    weight: 16,
    detail: `${crossings} crossing pair(s)`,
  });
  if (crossings > 0) {
    issues.push(`${crossings} arrow crossing(s) — use straight vertical drops or a bus, not diagonals.`);
  }

  const diagonalArrows = arrows.filter((a) => isDiagonalArrow(a));
  checks.push({
    id: "orthogonal-arrows",
    pass: diagonalArrows.length === 0,
    weight: 12,
    detail: `${diagonalArrows.length} diagonal`,
  });
  if (diagonalArrows.length > 0) {
    issues.push(`${diagonalArrows.length} diagonal arrow(s) — prefer vertical/horizontal segments.`);
  }

  const dangling = arrows.filter((a) => !a.startBinding?.elementId || !a.endBinding?.elementId);
  checks.push({
    id: "arrows-bound",
    pass: dangling.length === 0,
    weight: 10,
    detail: `${dangling.length} unbound`,
  });
  if (dangling.length > 0) {
    issues.push(`${dangling.length} arrow(s) not bound to shapes — remove or attach endpoints.`);
  }

  const fanOutPenalty = scoreDiskFanOut(arrows, elements);
  checks.push({
    id: "clean-disk-fan-out",
    pass: !fanOutPenalty.fail,
    weight: 14,
    detail: fanOutPenalty.detail,
  });
  if (fanOutPenalty.fail) {
    issues.push(fanOutPenalty.issue);
  }

  const overlaps = countBoxOverlaps(mainBoxes);
  checks.push({
    id: "no-box-overlap",
    pass: overlaps === 0,
    weight: 8,
    detail: `${overlaps} overlaps`,
  });
  if (overlaps > 0) {
    issues.push(`${overlaps} main box overlap(s).`);
  }

  const labelOcclusions = countTextOccludedByShapes(texts, elements);
  checks.push({
    id: "no-label-occlusion",
    pass: labelOcclusions === 0,
    weight: 12,
    detail: `${labelOcclusions} occluded label(s)`,
  });
  if (labelOcclusions > 0) {
    issues.push(`${labelOcclusions} label(s) covered by a shape — reserve gutter or move boxes.`);
  }

  const title = texts.find((t) => (t.fontSize ?? 16) >= 22 && !(t.groupIds ?? []).includes("legend"));
  checks.push({ id: "title-present", pass: Boolean(title), weight: 6 });
  if (!title) {
    issues.push("Missing prominent title.");
  }

  if (bbox) {
    const fillRatio = (bbox.width * bbox.height) / (1200 * 700);
    checks.push({
      id: "content-framing",
      pass: fillRatio >= 0.22 && bbox.height >= 320,
      weight: 10,
      detail: `${Math.round(fillRatio * 100)}% frame fill, h=${Math.round(bbox.height)}`,
    });
    if (!checks.at(-1).pass) {
      issues.push("Diagram too small or floating in empty canvas — expand layout or zoom capture.");
    }
  }

  if (pixelStats) {
    checks.push({
      id: "render-not-blank",
      pass: pixelStats.nonWhiteRatio >= 0.04,
      weight: 6,
      detail: `${(pixelStats.nonWhiteRatio * 100).toFixed(1)}% ink`,
    });
    if (pixelStats.nonWhiteRatio < 0.04) {
      issues.push("PNG mostly blank — capture or load failure.");
    }
  }

  const maxWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);
  const score = maxWeight ? Math.round((earned / maxWeight) * 100) : 0;

  return {
    score,
    checks,
    issues,
    stats: {
      elements: elements.length,
      boxes: boxes.length,
      arrows: arrows.length,
      swimlanes: swimlaneBgs.length,
      arrowCrossings: crossings,
      diagonalArrows: diagonalArrows.length,
      contentBBox: bbox,
    },
    pass: score >= 85 && issues.length === 0,
  };
}

function contentBoundingBox(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const e of elements) {
    if (e.isDeleted || e.groupIds?.includes("legend")) {
      continue;
    }
    const x = e.x ?? 0;
    const y = e.y ?? 0;
    const w = e.width ?? 0;
    const h = e.height ?? 0;
    if (e.type === "text") {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    } else if (e.type === "rectangle" || e.type === "arrow") {
      minX = Math.min(minX, x, x + w);
      minY = Math.min(minY, y, y + h);
      maxX = Math.max(maxX, x, x + w);
      maxY = Math.max(maxY, y, y + h);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function scoreLeftToRightFlow(boxes) {
  const actor = boxes.find((b) => b.customData?.kind === "actor");
  const storage = boxes.find((b) => b.customData?.kind === "storage");
  if (!actor || !storage) {
    return boxes.length >= 2;
  }
  return (actor.x ?? 0) + (actor.width ?? 0) < (storage.x ?? 0);
}

function arrowSegments(arrow) {
  const x = arrow.x ?? 0;
  const y = arrow.y ?? 0;
  const pts = arrow.points ?? [[0, 0], [arrow.width ?? 0, arrow.height ?? 0]];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({
      x1: x + pts[i][0],
      y1: y + pts[i][1],
      x2: x + pts[i + 1][0],
      y2: y + pts[i + 1][1],
    });
  }
  return segs;
}

function segmentsIntersect(s1, s2) {
  const d1x = s1.x2 - s1.x1;
  const d1y = s1.y2 - s1.y1;
  const d2x = s2.x2 - s2.x1;
  const d2y = s2.y2 - s2.y1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-6) {
    return false;
  }
  const t = ((s2.x1 - s1.x1) * d2y - (s2.y1 - s1.y1) * d2x) / denom;
  const u = ((s2.x1 - s1.x1) * d1y - (s2.y1 - s1.y1) * d1x) / denom;
  return t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95;
}

function countArrowCrossings(arrows) {
  const allSegs = arrows.flatMap(arrowSegments);
  let n = 0;
  for (let i = 0; i < allSegs.length; i++) {
    for (let j = i + 1; j < allSegs.length; j++) {
      if (segmentsIntersect(allSegs[i], allSegs[j])) {
        n++;
      }
    }
  }
  return n;
}

function isDiagonalArrow(arrow) {
  for (const seg of arrowSegments(arrow)) {
    const dx = Math.abs(seg.x2 - seg.x1);
    const dy = Math.abs(seg.y2 - seg.y1);
    if (dx > 10 && dy > 10) {
      return true;
    }
  }
  return false;
}

function scoreDiskFanOut(arrows, elements) {
  const storage = elements.find((e) => e.customData?.kind === "storage" && e.type === "rectangle");
  if (!storage) {
    return { fail: false, detail: "n/a" };
  }
  const out = arrows.filter((a) => a.startBinding?.elementId === storage.id);
  if (out.length < 3) {
    return { fail: false, detail: `${out.length} fan-out` };
  }
  const bad = out.filter((a) => isDiagonalArrow(a) || !a.endBinding?.elementId);
  if (bad.length > 0) {
    return {
      fail: true,
      detail: `${bad.length}/${out.length} messy fan-out`,
      issue: "Disk fan-out uses diagonal or loose arrows — use straight vertical drops to each viewer.",
    };
  }
  return { fail: false, detail: `${out.length} vertical fan-out` };
}

function countBoxOverlaps(boxes) {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsOverlap(boxes[i], boxes[j])) {
        n++;
      }
    }
  }
  return n;
}

function rectsOverlap(a, b, pad = 8) {
  const ax1 = a.x - pad;
  const ay1 = a.y - pad;
  const ax2 = a.x + (a.width ?? 0) + pad;
  const ay2 = a.y + (a.height ?? 0) + pad;
  const bx1 = b.x - pad;
  const by1 = b.y - pad;
  const bx2 = b.x + (b.width ?? 0) + pad;
  const by2 = b.y + (b.height ?? 0) + pad;
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

function countTextOccludedByShapes(texts, elements) {
  const obstacles = elements.filter(
    (e) =>
      e.type === "rectangle" &&
      !e.groupIds?.includes("legend") &&
      !e.groupIds?.includes("swimlane") &&
      (e.width ?? 0) > 40
  );
  let n = 0;
  for (const text of texts) {
    if (text.containerId || text.groupIds?.includes("legend")) {
      continue;
    }
    for (const box of obstacles) {
      if (textOccludedByRect(text, box)) {
        n++;
        break;
      }
    }
  }
  return n;
}

function textOverlapsRect(text, rect, pad = 2) {
  const tx1 = text.x ?? 0;
  const ty1 = text.y ?? 0;
  const tx2 = tx1 + (text.width ?? 0);
  const ty2 = ty1 + (text.height ?? 0);
  const rx1 = (rect.x ?? 0) - pad;
  const ry1 = (rect.y ?? 0) - pad;
  const rx2 = (rect.x ?? 0) + (rect.width ?? 0) + pad;
  const ry2 = (rect.y ?? 0) + (rect.height ?? 0) + pad;
  return tx1 < rx2 && tx2 > rx1 && ty1 < ry2 && ty2 > ry1;
}

function textOccludedByRect(text, rect, pad = 2) {
  if (!textOverlapsRect(text, rect, pad)) {
    return false;
  }
  const cx = (text.x ?? 0) + (text.width ?? 0) / 2;
  const cy = (text.y ?? 0) + (text.height ?? 0) / 2;
  const inset = 4;
  const rx1 = (rect.x ?? 0) + inset;
  const ry1 = (rect.y ?? 0) + inset;
  const rx2 = (rect.x ?? 0) + (rect.width ?? 0) - inset;
  const ry2 = (rect.y ?? 0) + (rect.height ?? 0) - inset;
  return !(cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2);
}

function tierLabel(score) {
  if (score < 40) return "incomprehensible";
  if (score < 65) return "major rework";
  if (score < 85) return "readable, issues remain";
  return "clear";
}

export function formatReviewMarkdown({ variant, sourcePath, scoreResult, pngPath }) {
  const lines = [
    `# ${variant} — visual review`,
    "",
    `- **Source:** \`${sourcePath}\``,
    `- **Preview:** \`${pngPath}\``,
    `- **Comprehensibility score:** ${scoreResult.score}/100 — *${tierLabel(scoreResult.score)}* (${scoreResult.pass ? "PASS" : "FAIL"})`,
    "",
    "> Score measures readability: swimlanes, orthogonal arrows, no crossings, bound endpoints, framing.",
    "",
    "## Checks",
    "",
  ];
  for (const c of scoreResult.checks) {
    lines.push(`- [${c.pass ? "x" : " "}] **${c.id}**${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (scoreResult.issues.length) {
    lines.push("", "## Issues (fix in next iteration)", "");
    for (const issue of scoreResult.issues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push("", "## Next iteration prompts", "");
  if (scoreResult.pass) {
    lines.push("- Minor typography polish only.");
  } else {
    for (const issue of scoreResult.issues.slice(0, 6)) {
      lines.push(`- Fix: ${issue}`);
    }
  }
  return lines.join("\n");
}

export { contentBoundingBox };
