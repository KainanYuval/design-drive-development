/** Agent-facing layout lint for `.excalidraw` JSON (no pixel analysis). */

export type DiagramLintSeverity = "error" | "warning";

export type DiagramLintIssue = {
  code: string;
  severity: DiagramLintSeverity;
  message: string;
  elementId: string;
};

type Element = {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  containerId?: string | null;
  startBinding?: { elementId?: string };
  endBinding?: { elementId?: string };
  points?: number[][];
};

export function lintDiagramJson(raw: string): DiagramLintIssue[] {
  let doc: { elements?: Element[] };
  try {
    doc = JSON.parse(raw) as { elements?: Element[] };
  } catch {
    return [
      {
        code: "invalid-json",
        severity: "error",
        message: "Diagram JSON is invalid — agent edits may have broken the file.",
        elementId: "",
      },
    ];
  }

  const elements = (doc.elements ?? []).filter((e) => !e.isDeleted);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const issues: DiagramLintIssue[] = [];

  const arrows = elements.filter((e) => e.type === "arrow");
  const obstacles = elements.filter(
    (e) =>
      (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond") &&
      !e.groupIds?.includes("legend") &&
      !e.groupIds?.includes("swimlane")
  );
  const texts = elements.filter((e) => e.type === "text" && !e.groupIds?.includes("legend"));

  for (const arrow of arrows) {
    if (!arrow.startBinding?.elementId || !arrow.endBinding?.elementId) {
      issues.push({
        code: "arrow-unbound",
        severity: "warning",
        message: "Arrow endpoint not bound to a shape — attach both ends.",
        elementId: arrow.id,
      });
    }

    const segs = arrowSegments(arrow);
    const skipIds = new Set(
      [arrow.startBinding?.elementId, arrow.endBinding?.elementId].filter(Boolean) as string[]
    );

    for (const seg of segs) {
      for (const other of arrows) {
        if (other.id === arrow.id) {
          continue;
        }
        for (const otherSeg of arrowSegments(other)) {
          if (segmentsIntersect(seg, otherSeg)) {
            issues.push({
              code: "arrow-crosses-arrow",
              severity: "warning",
              message: `Arrow crosses another arrow — reroute or use vertical/horizontal hops.`,
              elementId: arrow.id,
            });
            break;
          }
        }
      }

      for (const box of obstacles) {
        if (skipIds.has(box.id)) {
          continue;
        }
        if (segmentCrossesRectInterior(seg, box)) {
          issues.push({
            code: "arrow-through-shape",
            severity: "warning",
            message: `Arrow passes through “${box.id}” — route around or move the shape.`,
            elementId: arrow.id,
          });
          break;
        }
      }

      for (const label of texts) {
        if (label.containerId) {
          continue;
        }
        if (segmentCrossesRectInterior(seg, label)) {
          issues.push({
            code: "arrow-through-label",
            severity: "warning",
            message: `Arrow crosses label “${label.id}” — move label or reroute arrow.`,
            elementId: arrow.id,
          });
          break;
        }
      }
    }
  }

  for (const text of texts) {
    if (!text.containerId) {
      for (const box of obstacles) {
        if (textOccludedByRect(text, box)) {
          issues.push({
            code: "text-occluded-by-shape",
            severity: "error",
            message: `Text “${text.id}” is covered by “${box.id}” — move label or shape apart (reserve left gutter for lane labels).`,
            elementId: text.id,
          });
          break;
        }
      }
    }

    if (!text.containerId) {
      continue;
    }
    const container = byId.get(text.containerId);
    if (!container || container.type !== "rectangle") {
      continue;
    }

    const pad = 8;
    const cw = container.width ?? 0;
    const ch = container.height ?? 0;
    const tw = text.width ?? 0;
    const th = text.height ?? 0;

    if (tw > cw - pad || th > ch - pad) {
      issues.push({
        code: "text-overflow-container",
        severity: "error",
        message: `Label “${text.id}” overflows its box — shorten text, smaller font, or widen “${container.id}”.`,
        elementId: text.id,
      });
      continue;
    }

    const tx = text.x ?? 0;
    const ty = text.y ?? 0;
    const cx = container.x ?? 0;
    const cy = container.y ?? 0;
    if (
      tx < cx - pad ||
      ty < cy - pad ||
      tx + tw > cx + cw + pad ||
      ty + th > cy + ch + pad
    ) {
      issues.push({
        code: "text-outside-container",
        severity: "warning",
        message: `Label “${text.id}” sits outside “${container.id}” bounds — may render clipped.`,
        elementId: text.id,
      });
    }
  }

  return dedupeIssues(issues);
}

function dedupeIssues(issues: DiagramLintIssue[]): DiagramLintIssue[] {
  const seen = new Set<string>();
  const out: DiagramLintIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}:${issue.elementId}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function arrowSegments(arrow: Element) {
  const x = arrow.x ?? 0;
  const y = arrow.y ?? 0;
  const pts = arrow.points ?? [
    [0, 0],
    [arrow.width ?? 0, arrow.height ?? 0],
  ];
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
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

function segmentsIntersect(
  s1: { x1: number; y1: number; x2: number; y2: number },
  s2: { x1: number; y1: number; x2: number; y2: number }
): boolean {
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

function segmentCrossesRectInterior(
  seg: { x1: number; y1: number; x2: number; y2: number },
  rect: Element,
  inset = 6
): boolean {
  const rx1 = (rect.x ?? 0) + inset;
  const ry1 = (rect.y ?? 0) + inset;
  const rx2 = (rect.x ?? 0) + (rect.width ?? 0) - inset;
  const ry2 = (rect.y ?? 0) + (rect.height ?? 0) - inset;
  if (rx2 <= rx1 || ry2 <= ry1) {
    return false;
  }

  if (pointInRect(seg.x1, seg.y1, rx1, ry1, rx2, ry2) && pointInRect(seg.x2, seg.y2, rx1, ry1, rx2, ry2)) {
    return false;
  }

  const edges = [
    { x1: rx1, y1: ry1, x2: rx2, y2: ry1 },
    { x1: rx2, y1: ry1, x2: rx2, y2: ry2 },
    { x1: rx2, y1: ry2, x2: rx1, y2: ry2 },
    { x1: rx1, y1: ry2, x2: rx1, y2: ry1 },
  ];

  for (const edge of edges) {
    if (segmentsIntersect(seg, edge)) {
      return true;
    }
  }

  const mid = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 };
  return pointInRect(mid.x, mid.y, rx1, ry1, rx2, ry2);
}

function pointInRect(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}

function textOverlapsRect(text: Element, rect: Element, pad = 2): boolean {
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

/** True when overlap is accidental cover (label beside/on edge), not text placed inside a box. */
function textOccludedByRect(text: Element, rect: Element, pad = 2): boolean {
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
  return !pointInRect(cx, cy, rx1, ry1, rx2, ry2);
}
