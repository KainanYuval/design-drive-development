---
name: design-visual-iteration
description: >-
  RL-style visual design loop for DDD `.excalidraw` diagrams: programmatic PNG capture,
  rubric scoring, vision critique, patch, repeat. Use when a diagram must look polished
  (legend, alignment, spacing, arrow routing) or when running design-visual-iterate.mjs
  with Cursor SDK agents between iterations.
parent: design-drive-development
---

# Design visual iteration (capture → score → patch → repeat)

Treat diagram quality like reinforcement learning: **render → measure → act → render again**. Disk JSON stays source of truth; never judge layout from JSON alone.

## Prerequisites

```bash
npx playwright install chromium   # once per machine
cd extension && npm run build:applet   # ensures viewer/dist is current
```

## One-shot capture

```bash
node scripts/capture-diagram.mjs architecture.excalidraw --out project/experiments/design-visual-iteration/v0-baseline/preview.png
```

## Score + review artifact

```bash
node scripts/evaluate-diagram-visual.mjs architecture.excalidraw \
  --variant v0-baseline \
  --capture \
  --json-out project/experiments/design-visual-iteration/v0-baseline/score.json \
  --review-out project/experiments/design-visual-iteration/v0-baseline/review.md
```

## Full loop (saved variants + gallery)

```bash
node scripts/design-visual-iterate.mjs --diagram architecture.excalidraw --max-iterations 3 --target-score 80
```

Gallery index: `project/experiments/design-visual-iteration/index.md`

Each variant folder contains:

| File | Purpose |
| --- | --- |
| `diagram.excalidraw` | Frozen copy for that iteration |
| `preview.png` | Headless webview screenshot |
| `score.json` | Rubric breakdown + pixel stats |
| `review.md` | Human-readable issues + next fixes |
| `agent-meta.json` | Agent/heuristic patch metadata (when present) |

---

## Rubric (what “good” means)

Score target **≥ 85** with **zero open issues**. Tiers:

| Score | Meaning |
| --- | --- |
| &lt;40 | Incomprehensible |
| 40–64 | Major rework |
| 65–84 | Readable, issues remain |
| ≥85 | Clear |

### Structure (JSON)

1. **Legend** — panel + heading + ≥4 swatches.
2. **Swimlanes** — ≥3 labeled horizontal lanes (story reads top→bottom).
3. **Orthogonal arrows** — vertical/horizontal segments only; all endpoints bound.
4. **Clean disk fan-out** — straight vertical drops from file to each viewer (no diagonal fan).
5. **No arrow crossings** — segment intersection count = 0.
6. **Framing** — content fills frame (not tiny blob in empty canvas).

### Render (PNG / canvas pixels)

1. **Non-white ink** — 2–65% of canvas (not blank, not cramped).
2. **Legend ink** — upper-left 22×35% viewport region shows visible ink (legend actually rendered).

---

## Agent roles per iteration

When `CURSOR_API_KEY` is set, `design-visual-iterate.mjs` calls `@cursor/sdk` `Agent.prompt` with this skill + parent DDD skill. Rotate focus by score failures:

| Iteration focus | Skill emphasis | Fix |
| --- | --- | --- |
| 0 (baseline) | Capture only | Establish score |
| 1 | DDD legend + swimlane layout | Legend placement, box alignment |
| 2 | DDD metadata visual prefs | Spacing, typography, subtitle |
| 3 | Arrow routing | Reduce crossings; orthogonal hops |

Without API key, the script applies a **heuristic align/spacing pass** then re-scores.

### Manual Cursor agent (IDE)

If SDK unavailable, open a new agent chat with:

1. Attach `preview.png` from latest variant folder.
2. Paste `review.md` issues.
3. Instruction: “Follow `design-visual-iteration.md`; patch `architecture.excalidraw` only; minimal diff.”
4. Re-run evaluate script; save new variant folder as `vN-manual`.

---

## Vision critique checklist (human or multimodal agent)

After each capture, inspect the PNG:

- [ ] Legend readable without zoom; swatches match box colors on canvas.
- [ ] Title + subtitle hierarchy obvious at glance.
- [ ] Left→right story reads in one scan (authors → disk → viewers → webview).
- [ ] No arrow crosses main labels.
- [ ] Whitespace balanced — not cramped against legend or viewport edge.
- [ ] Sync footnote / annotations legible but subordinate.

Log failures as bullet issues in `review.md`; map each issue to a concrete JSON edit (move id, resize width, reroute arrow points).

---

## Do not

- Wipe or rewrite the whole diagram when score &lt; 80 — patch targeted elements.
- Commit unless user asks.
- Rely on extension tab for capture — use `capture-diagram.mjs` (headless webview).
- Skip saving PNG + JSON for each iteration — user compares variants in gallery.

---

## Related

- Parent workflow: [SKILL.md](./SKILL.md)
- JSON patterns: [excalidraw-format.md](./excalidraw-format.md)
- Scoring implementation: `scripts/lib/diagram-visual-score.mjs`
