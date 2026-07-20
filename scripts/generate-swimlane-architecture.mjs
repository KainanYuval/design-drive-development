#!/usr/bin/env node
/**
 * Generate swimlane architecture.excalidraw (readable DDD repo diagram).
 * Usage: node scripts/generate-swimlane-architecture.mjs [--out path] [--variant baseline|polished]
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const VARIANTS = {
  baseline: { laneGap: 88, boxH: 58, titleSize: 26 },
  polished: { laneGap: 96, boxH: 64, titleSize: 28 },
};

function el(partial) {
  return {
    angle: 0,
    fillStyle: "solid",
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: Math.floor(Math.random() * 99999),
    version: 2,
    versionNonce: Math.floor(Math.random() * 999999999),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...partial,
  };
}

function text(id, x, y, w, h, content, opts = {}) {
  return el({
    id,
    type: "text",
    x,
    y,
    width: w,
    height: h,
    strokeColor: opts.color ?? "#212529",
    backgroundColor: "transparent",
    strokeWidth: 1,
    roundness: null,
    text: content,
    fontSize: opts.fontSize ?? 13,
    fontFamily: 1,
    textAlign: opts.align ?? "left",
    verticalAlign: "middle",
    containerId: opts.containerId ?? null,
    originalText: content,
    autoResize: true,
    lineHeight: 1.25,
    groupIds: opts.groupIds ?? [],
  });
}

function rect(id, x, y, w, h, stroke, fill, opts = {}) {
  const r = el({
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: fill,
    strokeWidth: 2,
    roundness: { type: 3 },
    groupIds: opts.groupIds ?? [],
    customData: opts.customData,
  });
  if (opts.labelId) {
    r.boundElements.push({ type: "text", id: opts.labelId });
  }
  return r;
}

function arrow(id, startId, endId, points, x, y, w, h) {
  return el({
    id,
    type: "arrow",
    x,
    y,
    width: w,
    height: h,
    strokeColor: "#495057",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roundness: { type: 2 },
    points,
    startBinding: { elementId: startId, focus: 0, gap: 6 },
    endBinding: { elementId: endId, focus: 0, gap: 6 },
    startArrowhead: null,
    endArrowhead: "arrow",
  });
}

export function buildSwimlaneDiagram(variantName = "baseline") {
  const v = VARIANTS[variantName] ?? VARIANTS.baseline;
  const MAIN_X = 300;
  const LANE_W = 920;
  const laneH = v.boxH + 24;

  const lanes = [
    { id: "lane-1", label: "1 · Authoring", y: 108 },
    { id: "lane-2", label: "2 · Source of truth", y: 108 + v.laneGap },
    { id: "lane-3", label: "3 · Viewers", y: 108 + v.laneGap * 2 },
    { id: "lane-4", label: "4 · Render", y: 108 + v.laneGap * 3 },
  ];

  const elements = [];

  // Legend
  elements.push(
    rect("legend-panel", 24, 24, 248, 248, "#ced4da", "#ffffff", { groupIds: ["legend"] }),
    text("legend-h", 40, 34, 216, 20, "Legend", { fontSize: 15, groupIds: ["legend"] }),
    text("legend-d", 40, 52, 216, 14, "Colors & shapes on this diagram", {
      fontSize: 11,
      color: "#868e96",
      groupIds: ["legend"],
    })
  );

  const legendRows = [
    ["author-sw", "author-tx", "#fab005", "#fff3bf", "Author / agent"],
    ["disk-sw", "disk-tx", "#40c057", "#d3f9d8", "File on disk"],
    ["ext-sw", "ext-sw-tx", "#339af0", "#d0ebff", "Extension host"],
    ["rust-sw", "rust-sw-tx", "#fd7e14", "#ffe8cc", "Rust applet ★"],
    ["elec-sw", "elec-sw-tx", "#7950f2", "#e5dbff", "Electron fallback"],
    ["web-sw", "web-sw-tx", "#868e96", "#f1f3f5", "Shared webview"],
  ];
  legendRows.forEach(([sw, tx, stroke, fill, label], i) => {
    const y = 78 + i * 28;
    elements.push(
      rect(sw, 40, y, 28, 18, stroke, fill, { groupIds: ["legend"] }),
      text(tx, 76, y - 1, 180, 20, label, { fontSize: 12, groupIds: ["legend"] })
    );
  });

  // Title block
  elements.push(
    text("h1", MAIN_X, 28, LANE_W, 36, "Design Drive Development", {
      fontSize: v.titleSize,
      align: "center",
    }),
    text("h2", MAIN_X, 64, LANE_W, 22, "How `.excalidraw` on disk becomes live diagrams in Cursor", {
      fontSize: 14,
      align: "center",
      color: "#868e96",
    })
  );

  // Swimlane backgrounds + labels
  for (const lane of lanes) {
    elements.push(
      rect(`${lane.id}-bg`, MAIN_X, lane.y, LANE_W, laneH, "#e9ecef", "#f8f9fa", {
        groupIds: ["swimlane"],
      }),
      text(`${lane.id}-label`, MAIN_X + 12, lane.y + 8, 140, 18, lane.label, {
        fontSize: 12,
        color: "#495057",
        groupIds: ["swimlane"],
      })
    );
  }

  const cy = (lane) => lane.y + laneH / 2;
  const centerX = MAIN_X + LANE_W / 2;

  const agent = rect("agent", centerX - 120, cy(lanes[0]) - v.boxH / 2, 240, v.boxH, "#fab005", "#fff3bf", {
    labelId: "agent-t",
    customData: { kind: "actor" },
  });
  const disk = rect("disk", centerX - 180, cy(lanes[1]) - v.boxH / 2 - 4, 360, v.boxH + 8, "#40c057", "#d3f9d8", {
    labelId: "disk-t",
    customData: { kind: "storage" },
  });
  const ext = rect("ext", MAIN_X + 140, cy(lanes[2]) - v.boxH / 2, 200, v.boxH, "#339af0", "#d0ebff", {
    labelId: "ext-t",
    customData: { kind: "viewer", id: "extension" },
  });
  const rust = rect("rust", centerX - 100, cy(lanes[2]) - v.boxH / 2, 200, v.boxH, "#fd7e14", "#ffe8cc", {
    labelId: "rust-t",
    customData: { kind: "viewer", id: "rust", default: true },
  });
  const elec = rect("elec", MAIN_X + LANE_W - 340, cy(lanes[2]) - v.boxH / 2, 200, v.boxH, "#7950f2", "#e5dbff", {
    labelId: "elec-t",
    customData: { kind: "viewer", id: "electron" },
  });
  const web = rect("web", centerX - 160, cy(lanes[3]) - v.boxH / 2, 320, v.boxH, "#868e96", "#f1f3f5", {
    labelId: "web-t",
    customData: { kind: "runtime" },
  });

  elements.push(agent, disk, ext, rust, elec, web);

  elements.push(
    text("agent-t", agent.x + 10, agent.y + 8, agent.width - 20, 42, "Authors\nCursor skill · terminal agents", {
      containerId: "agent",
      align: "center",
    }),
    text("disk-t", disk.x + 10, disk.y + 10, disk.width - 20, 48, "architecture.excalidraw\nsingle source of truth on disk", {
      containerId: "disk",
      align: "center",
    }),
    text("side", disk.x, disk.y + disk.height + 6, disk.width, 16, "sidecars: *.metadata.md · designs/groups/ · project/", {
      fontSize: 11,
      color: "#2b8a3e",
      align: "center",
    }),
    text("ext-t", ext.x + 8, ext.y + 8, ext.width - 16, 42, "Extension\nextension/", {
      containerId: "ext",
      align: "center",
    }),
    text("rust-t", rust.x + 8, rust.y + 8, rust.width - 16, 42, "Rust applet ★\nnpm run view", {
      containerId: "rust",
      align: "center",
    }),
    text("elec-t", elec.x + 8, elec.y + 8, elec.width - 16, 42, "Electron\nview:electron", {
      containerId: "elec",
      align: "center",
    }),
    text("web-t", web.x + 8, web.y + 8, web.width - 16, 42, "Excalidraw webview\nextension/webview → media/ + viewer/dist/", {
      containerId: "web",
      align: "center",
    }),
    text("sync-note", MAIN_X + 80, lanes[3].y + laneH + 16, LANE_W - 160, 18, "Sync: 300 ms autosave · SHA-256 dedupe · defer reload while drawing", {
      fontSize: 12,
      color: "#868e96",
      align: "center",
    })
  );

  // Straight vertical / horizontal arrows only (2-point, bound)
  const gap = 8;
  elements.push(
    arrow("a1", "agent", "disk", [[0, 0], [0, lanes[1].y - (agent.y + agent.height)]], agent.x + agent.width / 2, agent.y + agent.height, 0, lanes[1].y - (agent.y + agent.height)),
    arrow("a2", "disk", "ext", [[0, 0], [0, lanes[2].y - (disk.y + disk.height)]], ext.x + ext.width / 2, disk.y + disk.height, 0, lanes[2].y - (disk.y + disk.height)),
    arrow("a3", "disk", "rust", [[0, 0], [0, lanes[2].y - (disk.y + disk.height)]], rust.x + rust.width / 2, disk.y + disk.height, 0, lanes[2].y - (disk.y + disk.height)),
    arrow("a4", "disk", "elec", [[0, 0], [0, lanes[2].y - (disk.y + disk.height)]], elec.x + elec.width / 2, disk.y + disk.height, 0, lanes[2].y - (disk.y + disk.height)),
    arrow("a5", "ext", "web", [[0, 0], [0, lanes[3].y - (ext.y + ext.height)]], ext.x + ext.width / 2, ext.y + ext.height, 0, lanes[3].y - (ext.y + ext.height)),
    arrow("a6", "rust", "web", [[0, 0], [0, lanes[3].y - (rust.y + rust.height)]], rust.x + rust.width / 2, rust.y + rust.height, 0, lanes[3].y - (rust.y + rust.height)),
    arrow("a7", "elec", "web", [[0, 0], [0, lanes[3].y - (elec.y + elec.height)]], elec.x + elec.width / 2, elec.y + elec.height, 0, lanes[3].y - (elec.y + elec.height))
  );

  return {
    type: "excalidraw",
    version: 2,
    source: "scripts/generate-swimlane-architecture.mjs",
    elements,
    appState: {
      gridSize: 20,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };
}

async function main() {
  let out = resolve("architecture.excalidraw");
  let variant = "baseline";
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--out") {
      out = resolve(process.argv[++i]);
    } else if (process.argv[i] === "--variant") {
      variant = process.argv[++i];
    }
  }
  const doc = buildSwimlaneDiagram(variant);
  await writeFile(out, JSON.stringify(doc, null, 2), "utf8");
  console.log(`Wrote ${out} (${variant}, ${doc.elements.length} elements)`);
}

if (process.argv[1]?.endsWith("generate-swimlane-architecture.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
