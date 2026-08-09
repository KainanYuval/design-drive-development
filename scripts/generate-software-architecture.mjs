#!/usr/bin/env node
/**
 * architecture.excalidraw — ownership + flow with I/O on boxes and arrows.
 * Question: who owns each software component, and what flows between them?
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FONT = 5;
const ROUGH = 1;
const GAP = 14;
const ROW = 110;

const COLORS = {
  client: { stroke: "#fab005", fill: "#fff3bf" },
  disk: { stroke: "#40c057", fill: "#d3f9d8" },
  host: { stroke: "#1e1e1e", fill: "transparent" },
  runtime: { stroke: "#868e96", fill: "#f1f3f5" },
  ink: "#1e1e1e",
  mute: "#868e96",
};

function el(partial) {
  return {
    angle: 0,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: ROUGH,
    opacity: 100,
    groupIds: [],
    frameId: null,
    isDeleted: false,
    boundElements: [],
    link: null,
    locked: false,
    strokeColor: COLORS.ink,
    backgroundColor: "transparent",
    ...partial,
  };
}

function cx(b) {
  return b.x + b.width / 2;
}

function cy(b) {
  return b.y + b.height / 2;
}

function focusOn(fromX, box) {
  const half = box.width / 2;
  return half <= 0 ? 0 : Math.max(-1, Math.min(1, (fromX - cx(box)) / half));
}

function textEl(id, x, y, w, h, content, opts = {}) {
  return el({
    id,
    type: "text",
    x,
    y,
    width: w,
    height: h,
    strokeColor: opts.color ?? COLORS.ink,
    text: content,
    originalText: content,
    fontSize: opts.fontSize ?? 16,
    fontFamily: FONT,
    textAlign: opts.align ?? "center",
    verticalAlign: "middle",
    containerId: opts.containerId ?? null,
    autoResize: true,
    lineHeight: 1.25,
    groupIds: opts.groupIds ?? [],
  });
}

function rect(id, x, y, w, h, colors, labelId) {
  return el({
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    strokeColor: colors.stroke,
    backgroundColor: colors.fill,
    roundness: { type: 3 },
    boundElements: labelId ? [{ type: "text", id: labelId }] : [],
  });
}

function oval(id, x, y, w, h, colors, labelId) {
  return el({
    id,
    type: "ellipse",
    x,
    y,
    width: w,
    height: h,
    strokeColor: colors.stroke,
    backgroundColor: colors.fill,
    roundness: { type: 2 },
    boundElements: labelId ? [{ type: "text", id: labelId }] : [],
  });
}

/** Box: title + optional tech + IO lines inside. */
function labeledBox(id, x, y, w, h, colors, title, tech, ioLines, kind = "rect") {
  const labelId = `${id}-t`;
  const shape = { x, y, width: w, height: h };
  const body = kind === "ellipse"
    ? oval(id, x, y, w, h, colors, labelId)
    : rect(id, x, y, w, h, colors, labelId);

  const lines = [title];
  if (tech) {
    lines.push("", tech);
  }
  if (ioLines?.length) {
    lines.push("");
    for (const line of ioLines) {
      lines.push(line);
    }
  }
  const content = lines.join("\n");
  const textH = Math.min(h - 12, 20 + lines.length * 16);
  const t = textEl(labelId, x + 10, y + (h - textH) / 2, w - 20, textH, content, {
    containerId: id,
    fontSize: ioLines?.length ? 14 : 16,
  });
  return { el: body, text: t, shape };
}

function bind(a, b, arrowId) {
  a.boundElements.push({ type: "arrow", id: arrowId });
  b.boundElements.push({ type: "arrow", id: arrowId });
}

function arrowDown(id, from, to, { startFocus = 0, endFocus = 0, dashed = false, label } = {}) {
  const sx = cx(from.shape) + startFocus * (from.shape.width / 2);
  const sy = from.shape.y + from.shape.height;
  const tx = cx(to.shape) + endFocus * (to.shape.width / 2);
  const ty = to.shape.y;
  const dx = tx - sx;
  const dy = ty - sy - GAP;

  const arrow = el({
    id,
    type: "arrow",
    x: sx,
    y: sy,
    width: Math.abs(dx),
    height: Math.max(dy, 24),
    strokeColor: dashed ? COLORS.mute : COLORS.ink,
    strokeStyle: dashed ? "dashed" : "solid",
    points: [
      [0, 0],
      [dx, dy],
    ],
    startBinding: { elementId: from.el.id, focus: startFocus, gap: GAP },
    endBinding: { elementId: to.el.id, focus: endFocus, gap: GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
    boundElements: label ? [{ type: "text", id: `${id}-lbl` }] : [],
  });
  bind(from.el, to.el, id);

  const out = [arrow];
  if (label) {
    out.push(
      textEl(`${id}-lbl`, sx + dx / 2 - 56, sy + dy / 2 - 12, 112, 24, label, {
        containerId: id,
        fontSize: 13,
        color: COLORS.mute,
      })
    );
  }
  return out;
}

/** Return path up the left side — change → save (dashed). Keeps right free for human. */
function arrowUpSide(id, from, to, label) {
  const sx = from.shape.x;
  const sy = cy(from.shape);
  const tx = to.shape.x;
  const ty = cy(to.shape);
  const midX = Math.min(sx, tx) - 64;
  const p0 = [0, 0];
  const p1 = [midX - sx, 0];
  const p2 = [midX - sx, ty - sy];
  const p3 = [tx - sx, ty - sy];

  const arrow = el({
    id,
    type: "arrow",
    x: sx,
    y: sy,
    width: Math.abs(midX - sx) + 20,
    height: Math.abs(ty - sy),
    strokeColor: COLORS.mute,
    strokeStyle: "dashed",
    points: [p0, p1, p2, p3],
    startBinding: { elementId: from.el.id, focus: -1, gap: GAP },
    endBinding: { elementId: to.el.id, focus: -1, gap: GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
    boundElements: label ? [{ type: "text", id: `${id}-lbl` }] : [],
  });
  bind(from.el, to.el, id);

  const out = [arrow];
  if (label) {
    out.push(
      textEl(`${id}-lbl`, midX - 96, (sy + ty) / 2 - 20, 90, 40, label, {
        align: "right",
        fontSize: 12,
        color: COLORS.mute,
      })
    );
  }
  return out;
}

function buildLegend() {
  const elements = [];
  const x = 24;
  const y = 24;
  const w = 248;

  elements.push(
    el({
      id: "legend-panel",
      type: "rectangle",
      x,
      y,
      width: w,
      height: 280,
      strokeColor: "#ced4da",
      backgroundColor: "#ffffff",
      roundness: { type: 3 },
      groupIds: ["legend"],
    }),
    textEl("legend-h", x + 12, y + 10, w - 24, 18, "Legend", {
      align: "left",
      fontSize: 14,
      groupIds: ["legend"],
    }),
    textEl("legend-q", x + 12, y + 30, w - 24, 40, "Who owns each part?\nWhat flows between them?", {
      align: "left",
      fontSize: 11,
      color: COLORS.mute,
      groupIds: ["legend"],
    })
  );

  const rows = [
    { id: "l-client", colors: COLORS.client, kind: "rect", label: "Client — writes disk" },
    { id: "l-disk", colors: COLORS.disk, kind: "rect", label: "Disk — shared file" },
    { id: "l-host", colors: COLORS.host, kind: "rect", label: "Host — window + sync" },
    { id: "l-rt", colors: COLORS.runtime, kind: "ellipse", label: "Runtime — shared JS" },
  ];

  rows.forEach((row, i) => {
    const ry = y + 82 + i * 26;
    if (row.kind === "ellipse") {
      elements.push(
        el({
          id: row.id,
          type: "ellipse",
          x: x + 14,
          y: ry - 2,
          width: 26,
          height: 18,
          strokeColor: row.colors.stroke,
          backgroundColor: row.colors.fill,
          groupIds: ["legend"],
        })
      );
    } else {
      elements.push(
        el({
          id: row.id,
          type: "rectangle",
          x: x + 14,
          y: ry,
          width: 26,
          height: 16,
          strokeColor: row.colors.stroke,
          backgroundColor: row.colors.fill,
          roundness: { type: 3 },
          groupIds: ["legend"],
        })
      );
    }
    elements.push(
      textEl(`${row.id}-tx`, x + 48, ry - 2, w - 60, 18, row.label, {
        align: "left",
        fontSize: 11,
        groupIds: ["legend"],
      })
    );
  });

  const arrowY0 = y + 82 + rows.length * 26 + 6;
  [
    { id: "l-solid", style: "solid", color: COLORS.ink, label: "solid ↓ — forward IO" },
    { id: "l-dash", style: "dashed", color: COLORS.mute, label: "dashed — load / return IO" },
  ].forEach((row, i) => {
    const ay = arrowY0 + i * 20;
    elements.push(
      el({
        id: row.id,
        type: "line",
        x: x + 14,
        y: ay + 8,
        width: 26,
        height: 0,
        strokeColor: row.color,
        strokeStyle: row.style,
        points: [
          [0, 0],
          [26, 0],
        ],
        groupIds: ["legend"],
      }),
      textEl(`${row.id}-tx`, x + 48, ay, w - 60, 18, row.label, {
        align: "left",
        fontSize: 11,
        groupIds: ["legend"],
      })
    );
  });

  return elements;
}

export function buildSoftwareArchitecture() {
  const elements = buildLegend();

  const MAIN_X = 320;
  const MAIN_W = 560;
  const CENTER = MAIN_X + MAIN_W / 2;

  elements.push(
    textEl("title", MAIN_X, 24, MAIN_W, 28, "Software components & ownership", {
      align: "left",
      fontSize: 22,
    }),
    textEl("subtitle", MAIN_X, 52, MAIN_W, 22, "Flow: write → watch → load → change → save", {
      align: "left",
      fontSize: 14,
      color: COLORS.mute,
    })
  );

  let y = 96;
  const CW = 180;
  const CH = 88;
  const CG = 40;
  const rowW = CW * 2 + CG;
  const x0 = CENTER - rowW / 2;

  // Agents write disk directly (left flow)
  const agents = [
    labeledBox("cursor-agent", x0, y, CW, CH, COLORS.client, "cursor agent", "skill", [
      "OUT write JSON",
    ]),
    labeledBox("term-agent", x0 + CW + CG, y, CW, CH, COLORS.client, "terminal agent", "edits", [
      "OUT write JSON",
    ]),
  ];

  y += CH + ROW;
  const disk = labeledBox("disk", x0, y, rowW, 96, COLORS.disk, "diagram file", "*.excalidraw", [
    "IN agent writes · host saves",
    "OUT file bytes → hosts",
  ]);

  y += 96 + ROW;
  const HW = 280;
  const HH = 120;
  const hosts = labeledBox(
    "hosts",
    CENTER - HW / 2 - 40,
    y,
    HW,
    HH,
    COLORS.host,
    "ide · rust hosts",
    null,
    ["IN watch · paint", "OUT load · autosave"]
  );
  // Human beside hosts — paint in, no arrow through disk
  const human = labeledBox(
    "human",
    hosts.shape.x + HW + 36,
    y + 16,
    150,
    HH - 32,
    COLORS.client,
    "human",
    "canvas",
    ["OUT paint"]
  );

  y += HH + ROW;
  const RW = 260;
  const RH = 140;
  const runtime = labeledBox(
    "runtime",
    CENTER - RW / 2 - 40,
    y,
    RW,
    RH,
    COLORS.runtime,
    "excalidraw code",
    "js",
    ["IN scene JSON", "OUT change events"],
    "ellipse"
  );

  for (const p of [...agents, disk, hosts, human, runtime]) {
    elements.push(p.el, p.text);
  }

  for (const a of agents) {
    elements.push(
      ...arrowDown(`a-${a.el.id}-disk`, a, disk, {
        endFocus: focusOn(cx(a.shape), disk.shape),
        label: "write JSON",
      })
    );
  }

  // human (right) → hosts (left): horizontal paint
  const paintSx = human.shape.x;
  const paintSy = cy(human.shape);
  const paintTx = hosts.shape.x + hosts.shape.width;
  const paintDx = paintTx - paintSx - GAP;
  const paintArrow = el({
    id: "a-human-hosts",
    type: "arrow",
    x: paintSx,
    y: paintSy,
    width: Math.abs(paintDx),
    height: 0,
    strokeColor: COLORS.ink,
    points: [
      [0, 0],
      [paintDx, 0],
    ],
    startBinding: { elementId: human.el.id, focus: -1, gap: GAP },
    endBinding: { elementId: hosts.el.id, focus: 1, gap: GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
    boundElements: [{ type: "text", id: "a-human-hosts-lbl" }],
  });
  bind(human.el, hosts.el, "a-human-hosts");

  elements.push(
    paintArrow,
    textEl(
      "a-human-hosts-lbl",
      (paintSx + paintTx) / 2 - 28,
      paintSy - 22,
      56,
      20,
      "paint",
      { containerId: "a-human-hosts", fontSize: 13, color: COLORS.mute }
    ),
    ...arrowDown("a-disk-hosts", disk, hosts, { label: "watch / load" }),
    ...arrowDown("a-hosts-runtime", hosts, runtime, {
      dashed: true,
      label: "scene JSON",
    }),
    ...arrowUpSide("a-runtime-hosts", runtime, hosts, "change\nevents"),
    ...arrowUpSide("a-hosts-disk", hosts, disk, "autosave\nJSON")
  );

  elements.push(
    textEl(
      "note",
      MAIN_X,
      y + RH + 40,
      MAIN_W,
      36,
      "Solid ↓ forward. Dashed = load + return path. Host owns sync; runtime owns canvas only.",
      { align: "center", fontSize: 12, color: COLORS.mute }
    )
  );

  return {
    type: "excalidraw",
    version: 2,
    source: "scripts/generate-software-architecture.mjs",
    elements,
    appState: {
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      viewBackgroundColor: "#ffffff",
      zoom: { value: 0.95 },
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
