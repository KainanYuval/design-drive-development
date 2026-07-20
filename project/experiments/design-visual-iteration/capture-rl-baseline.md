# Design visual iteration — programmatic capture RL loop

## Context

Re-run after user feedback: old rubric scored 100 while diagram was incomprehensible; all iteration PNGs identical because heuristics were no-ops.

## Method

- **Rubric rewrite:** comprehensibility checks (swimlanes, orthogonal arrows, disk fan-out, crossings, framing).
- **Capture fix:** zoom-to-content bbox, hide Excalidraw chrome.
- **Variants:** v0 frozen bad layout; v1/v2 from `generate-swimlane-architecture.mjs`.

## Results

| Variant | Score | Tier | Pass |
| --- | ---: | --- | :---: |
| v0-baseline | 56 | major rework | no |
| v1-swimlanes | 100 | clear | yes |
| v2-polished | 100 | clear | yes |

Gallery: [index.md](./index.md)

## Notes

- Live diagram updated: `architecture.excalidraw` = v1 swimlane baseline.
- v2-polished adds lane spacing + larger title for side-by-side compare.
