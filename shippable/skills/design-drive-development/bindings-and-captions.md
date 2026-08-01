# Bindings and captions (required)

Read this before creating or moving shapes, arrows, lines, or labels on any `.excalidraw` diagram.

## Why bindings alone are not enough

Excalidraw renders arrows and lines from **`x`, `y`, `width`, `height`, and `points`**, not only from `startBinding` / `endBinding`.

When an agent moves a shape on disk (including live multi-step updates during **agent turn**), the open host loads raw JSON via `updateScene`. It does **not** run Excalidraw’s in-app binding solver. If you update an endpoint shape but leave stale arrow geometry, the arrow will look detached even when bindings are present.

**Rule:** any write that moves or resizes an endpoint must update **every connected arrow/line in the same save** (or the same animation frame).

---

## Arrows and lines

### Required on every arrow / line

1. **`startBinding.elementId`** and **`endBinding.elementId`** — must reference existing, non-deleted elements.
2. **`boundElements` on both endpoints** — each connected shape must include `{ "type": "arrow", "id": "<arrow-id>" }` (or `"line"` for line elements).
3. **Fresh geometry** — `x`, `y`, `width`, `height`, and `points` must match the current endpoint positions (approximate is fine; bindings + sane geometry reload cleanly).

### When you move, resize, or replace a shape

In **one atomic write**, patch:

- the shape’s `x`, `y`, `width`, `height`
- every arrow/line whose `startBinding` or `endBinding` references that shape
- optional: bump `version` / `versionNonce` / `updated` on touched elements

Do **not** emit a sequence of disk updates that moves an endpoint without updating its arrows in the same JSON revision.

### Multi-step / live agent turn animation

If you animate by writing the diagram many times (e.g. orbit over 10 seconds):

- **Each frame** must update the moving element **and** all arrows/lines bound to it.
- Keep `startBinding` / `endBinding` and endpoint `boundElements` intact every frame.

### Lint

Host linter reports `arrow-unbound` when bindings are missing. Treat that as a blocking defect before ending a design turn.

---

## Captions and labels

### Inside objects — not overlays

**Shape names and short captions belong on the object**, not as free-floating text stacked on top.

| Correct | Incorrect |
|---------|-----------|
| Text with `containerId: "<parent-shape-id>"` | Same label with `containerId: null` over a box |
| Parent shape lists `{ "type": "text", "id": "<label-id>" }` in `boundElements` | Orphan text visually centered on a shape but not bound |
| `textAlign: "center"`, `verticalAlign: "middle"` for in-shape titles | Draggable overlay that survives shape moves independently |

**Arrow / flow names:** bind label text to the arrow (arrow’s `boundElements` + text child), not a separate floating text box near the stroke.

**Exceptions:**

- **Legend** rows in the upper-left legend panel (`groupIds: ["legend"]`) may use free text beside swatches.
- **Diagram title** or **lane labels** may be free text when they are not captions of a single shape (e.g. swimlane gutter labels).

### Do not

- Put service/database names as overlay text on top of rectangles “for speed”.
- Leave captions behind when moving a shape — move the bound text with the parent (via `containerId`; Excalidraw keeps relative layout).

---

## Pre-save checklist

Before each diagram write (especially during agent turn):

1. Every arrow/line has both bindings and endpoint `boundElements` entries.
2. No arrow geometry still points at pre-move coordinates.
3. Every semantic name on a box/ellipse/diamond is `containerId`-bound text, not overlay.
4. Re-read `<basename>.diagram-lint.json` if the host publishes lint for this file.

---

## Quick reference (arrow between `from-id` and `to-id`)

```json
{
  "id": "arrow-from-to",
  "type": "arrow",
  "x": 100,
  "y": 200,
  "width": 120,
  "height": 0,
  "points": [[0, 0], [120, 0]],
  "startBinding": { "elementId": "from-id", "focus": 0, "gap": 4 },
  "endBinding": { "elementId": "to-id", "focus": 0, "gap": 4 },
  "startArrowhead": null,
  "endArrowhead": "arrow"
}
```

On `from-id` and `to-id`:

```json
"boundElements": [
  { "type": "arrow", "id": "arrow-from-to" }
]
```

Label on `from-id`:

```json
{
  "id": "from-id-label",
  "type": "text",
  "containerId": "from-id",
  "text": "Auth",
  "originalText": "Auth",
  "textAlign": "center",
  "verticalAlign": "middle"
}
```

On `from-id`:

```json
"boundElements": [
  { "type": "text", "id": "from-id-label" }
]
```
