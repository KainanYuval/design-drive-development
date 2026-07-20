# Design visual iteration gallery

| Variant | Score | Pass | Preview | Review |
| --- | ---: | :---: | --- | --- |
| v0-baseline | 56 | no | [preview](v0-baseline/preview.png) | [review](v0-baseline/review.md) |
| v1-swimlanes | 100 | yes | [preview](v1-swimlanes/preview.png) | [review](v1-swimlanes/review.md) |
| v2-polished | 100 | yes | [preview](v2-polished/preview.png) | [review](v2-polished/review.md) |

## Score tiers

- **<40** incomprehensible
- **40–64** major rework
- **65–84** readable, issues remain
- **≥85** clear

## Regenerate

```bash
node scripts/generate-swimlane-architecture.mjs --out architecture.excalidraw
node scripts/evaluate-diagram-visual.mjs architecture.excalidraw --capture
```
