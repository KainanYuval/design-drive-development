#!/usr/bin/env node
/**
 * Generate architecture.excalidraw — DDD software architecture (readable layout).
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
    fontSize: opts.fontSize ?? 11,
    fontFamily: 1,
    textAlign: opts.align ?? "left",
    verticalAlign: "top",
    containerId: opts.containerId ?? null,
    originalText: content,
    autoResize: true,
    lineHeight: 1.2,
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

function solidArrow(id, startId, endId, x, y, h) {
  return el({
    id,
    type: "arrow",
    x,
    y,
    width: 0,
    height: h,
    strokeColor: "#495057",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roundness: { type: 2 },
    points: [
      [0, 0],
      [0, h],
    ],
    startBinding: { elementId: startId, focus: 0, gap: 4 },
    endBinding: { elementId: endId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    customData: { pattern: "sync" },
  });
}


export function buildSoftwareArchitecture() {
  const MX = 300;
  const LW = 920;
  const elements = [];

  // Legend
  elements.push(
    rect("legend-panel", 24, 24, 248, 268, "#ced4da", "#ffffff", { groupIds: ["legend"] }),
    text("legend-h", 40, 34, 216, 16, "Legend", { fontSize: 13, groupIds: ["legend"] })
  );
  [
    ["l-agent", "#fab005", "#fff3bf", "Agent / tooling"],
    ["l-disk", "#40c057", "#d3f9d8", "Disk artifact"],
    ["l-ext", "#339af0", "#d0ebff", "Extension host"],
    ["l-rust", "#fd7e14", "#ffe8cc", "Rust host ★"],
    ["l-elec", "#7950f2", "#e5dbff", "Electron host"],
    ["l-web", "#868e96", "#f1f3f5", "Shared webview"],
    ["l-build", "#e64980", "#ffdeeb", "Build / CLI"],
  ].forEach(([id, stroke, fill, label], i) => {
    const y = 56 + i * 24;
    elements.push(
      rect(`${id}-sw`, 40, y, 24, 14, stroke, fill, { groupIds: ["legend"] }),
      text(`${id}-tx`, 72, y - 1, 190, 16, label, { fontSize: 10, groupIds: ["legend"] })
    );
  });
  elements.push(
    text("l-solid", 40, 232, 220, 14, "Solid ↓ = read/write/watch on disk", {
      fontSize: 9,
      color: "#495057",
      groupIds: ["legend"],
    }),
    text("l-dash", 40, 248, 220, 14, "Dashed ↓ = spawn app or build step", {
      fontSize: 9,
      color: "#868e96",
      groupIds: ["legend"],
    })
  );

  elements.push(
    text("h1", MX, 20, LW, 28, "Design Drive Development — Software Architecture", {
      fontSize: 22,
      align: "center",
    }),
    text("h2", MX, 48, LW, 16, "All hosts sync through *.excalidraw on disk — nothing bypasses persistence", {
      fontSize: 12,
      align: "center",
      color: "#868e96",
    })
  );

  const lanes = [
    { id: "lane-1", label: "1 · Authoring", y: 72, h: 68 },
    { id: "lane-2", label: "2 · Persistence", y: 152, h: 108 },
    { id: "lane-3", label: "3 · Host shells", y: 272, h: 88 },
    { id: "lane-4", label: "4 · Shared runtime UI", y: 376, h: 64 },
    { id: "lane-5", label: "5 · Build & launch", y: 456, h: 56 },
  ];

  const LABEL_GUTTER = 148;
  const CONTENT_X = MX + LABEL_GUTTER;
  const CONTENT_W = LW - LABEL_GUTTER;
  const COL_GAP = 36;

  for (const lane of lanes) {
    elements.push(
      rect(`${lane.id}-bg`, MX, lane.y, LW, lane.h, "#dee2e6", "#f8f9fa", { groupIds: ["swimlane"] }),
      text(`${lane.id}-lbl`, MX + 10, lane.y + lane.h / 2 - 8, LABEL_GUTTER - 16, 16, lane.label, {
        fontSize: 10,
        color: "#495057",
        groupIds: ["swimlane"],
      })
    );
  }

  const midY = (lane) => lane.y + lane.h / 2;

  const hostW = Math.floor((CONTENT_W - COL_GAP * 2) / 3);
  const hostXs = [
    CONTENT_X,
    CONTENT_X + hostW + COL_GAP,
    CONTENT_X + (hostW + COL_GAP) * 2,
  ];

  const skill = rect("skill", hostXs[0], midY(lanes[0]) - 28, hostW, 56, "#fab005", "#fff3bf", {
    labelId: "skill-t",
    customData: { kind: "agent" },
  });
  const scripts = rect("scripts", hostXs[1], midY(lanes[0]) - 28, hostW, 56, "#fab005", "#fff3bf", {
    labelId: "scripts-t",
    customData: { kind: "agent" },
  });
  const term = rect("term", hostXs[2], midY(lanes[0]) - 28, hostW, 56, "#fab005", "#fff3bf", {
    labelId: "term-t",
    customData: { kind: "agent" },
  });

  // Lane 2 — wide excal bar (+ satellite paths in subtitle — no chips blocking arrows)
  const excal = rect("excal", CONTENT_X, lanes[1].y + 16, CONTENT_W, 64, "#40c057", "#d3f9d8", {
    labelId: "excal-t",
    customData: { kind: "storage", role: "diagram" },
  });

  // Lane 3 — hosts (columns align with authoring)
  const extension = rect("extension", hostXs[0], midY(lanes[2]) - 32, hostW, 64, "#339af0", "#d0ebff", {
    labelId: "ext-host-t",
    customData: { kind: "host", id: "extension" },
  });
  const rust = rect("rust-host", hostXs[1], midY(lanes[2]) - 32, hostW, 64, "#fd7e14", "#ffe8cc", {
    labelId: "rust-host-t",
    customData: { kind: "host", id: "rust", default: true },
  });
  const electron = rect("elec-host", hostXs[2], midY(lanes[2]) - 32, hostW, 64, "#7950f2", "#e5dbff", {
    labelId: "elec-host-t",
    customData: { kind: "host", id: "electron" },
  });

  // Lane 4 — webview
  const webview = rect("webview", CONTENT_X, midY(lanes[3]) - 26, CONTENT_W, 52, "#868e96", "#f1f3f5", {
    labelId: "webview-t",
    customData: { kind: "runtime" },
  });

  // Lane 5 — build
  const buildWeb = rect("build-web", hostXs[0], midY(lanes[4]) - 22, hostW, 44, "#e64980", "#ffdeeb", {
    labelId: "build-web-t",
    customData: { kind: "build" },
  });
  const buildApplet = rect("build-applet", hostXs[1], midY(lanes[4]) - 22, hostW, 44, "#e64980", "#ffdeeb", {
    labelId: "build-applet-t",
    customData: { kind: "build" },
  });
  const buildRust = rect("build-rust", hostXs[2], midY(lanes[4]) - 22, hostW, 44, "#e64980", "#ffdeeb", {
    labelId: "build-rust-t",
    customData: { kind: "build" },
  });

  elements.push(skill, scripts, term, excal, extension, rust, electron, webview, buildWeb, buildApplet, buildRust);

  const cx = (box) => box.x + box.width / 2;

  elements.push(
    text("skill-t", skill.x + 6, skill.y + 6, skill.width - 12, 44, "Cursor agent + DDD skill\nread/write *.excalidraw · metadata · menus", {
      containerId: "skill",
      fontSize: 10,
    }),
    text("scripts-t", scripts.x + 6, scripts.y + 6, scripts.width - 12, 44, "Headless scripts\ncapture · evaluate · iterate · generate", {
      containerId: "scripts",
      fontSize: 10,
    }),
    text("term-t", term.x + 6, term.y + 6, term.width - 12, 44, "Terminal harness\nnpm run view — spawns host\n(still reads same file on disk)", {
      containerId: "term",
      fontSize: 10,
    }),
    text("excal-t", excal.x + 8, excal.y + 10, excal.width - 16, 44, "*.excalidraw on disk — single source of truth\nelements · appState · files  ·  *.metadata.md  ·  .designs/ (extension)  ·  project/", {
      containerId: "excal",
      fontSize: 10,
      align: "center",
    }),
    text("ext-host-t", extension.x + 6, extension.y + 6, extension.width - 12, 52, "Cursor extension\neditorProvider · document · designLibrary\n.designs/ groups · watch + IPC", {
      containerId: "extension",
      fontSize: 10,
    }),
    text("rust-host-t", rust.x + 6, rust.y + 6, rust.width - 12, 52, "Rust applet ★ default\nhost.rs · wry · ddd://\nnotify watcher", {
      containerId: "rust-host",
      fontSize: 10,
    }),
    text("elec-host-t", electron.x + 6, electron.y + 6, electron.width - 12, 52, "Electron fallback\nhostSession · preload\nIPC + fs.watch", {
      containerId: "elec-host",
      fontSize: 10,
    }),
    text("webview-t", webview.x + 8, webview.y + 8, webview.width - 16, 36, "Shared webview — App.tsx · Excalidraw · sync guards\nbuilt: extension/webview → media/ + viewer/dist/", {
      containerId: "webview",
      fontSize: 10,
      align: "center",
    }),
    text("build-web-t", buildWeb.x + 6, buildWeb.y + 6, buildWeb.width - 12, 32, "npm run build:webview", { containerId: "build-web", fontSize: 10, align: "center" }),
    text("build-applet-t", buildApplet.x + 6, buildApplet.y + 6, buildApplet.width - 12, 32, "npm run build:applet", { containerId: "build-applet", fontSize: 10, align: "center" }),
    text("build-rust-t", buildRust.x + 6, buildRust.y + 6, buildRust.width - 12, 32, "cargo build --release", { containerId: "build-rust", fontSize: 10, align: "center" }),
    text("sync-note", MX + 40, lanes[4].y + lanes[4].h + 8, LW - 80, 28, "Sync: 300 ms autosave · SHA-256 dedupe · stale/empty guards · watchers only", {
      fontSize: 10,
      color: "#868e96",
      align: "center",
    })
  );

  const drop = (from, to, fromBox, toBox, anchorBox = toBox) => {
    const x = cx(anchorBox);
    const y0 = fromBox.y + fromBox.height;
    const h = toBox.y - y0;
    return solidArrow(`a-${from}-${to}`, from, to, x, y0, h);
  };

  // Authoring → excal (each column drops into shared file bar)
  elements.push(
    drop("skill", "excal", skill, excal, skill),
    drop("scripts", "excal", scripts, excal, scripts),
    drop("term", "excal", term, excal, term)
  );

  // excal → hosts (straight vertical per column — no blobs in arrow path)
  elements.push(
    drop("excal", "extension", excal, extension, extension),
    drop("excal", "rust-host", excal, rust, rust),
    drop("excal", "elec-host", excal, electron, electron)
  );

  // hosts → webview
  elements.push(
    drop("extension", "webview", extension, webview),
    drop("rust-host", "webview", rust, webview),
    drop("elec-host", "webview", electron, webview)
  );

  elements.push(
    text("build-note", CONTENT_X, lanes[4].y + lanes[4].h + 36, CONTENT_W, 14, "Build chain: build:webview → build:applet copies bundle to viewer/dist/ · cargo builds Rust launcher", {
      fontSize: 9,
      color: "#868e96",
      align: "center",
    })
  );

  return {
    type: "excalidraw",
    version: 2,
    source: "scripts/generate-software-architecture.mjs",
    elements,
    appState: {
      gridSize: 20,
      viewBackgroundColor: "#ffffff",
      zoom: { value: 0.92 },
      scrollX: 0,
      scrollY: 0,
    },
    files: {},
  };
}

async function main() {
  const out = resolve(process.argv[2] ?? "architecture.excalidraw");
  await writeFile(out, JSON.stringify(buildSoftwareArchitecture(), null, 2), "utf8");
  console.log(`Wrote ${out}`);
}

if (process.argv[1]?.endsWith("generate-software-architecture.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
