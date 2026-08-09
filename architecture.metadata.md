# Architecture Metadata

## Constraints

- `.excalidraw` JSON on disk is the only shared state; no duplicate sync layer.
- Extension renders, autosaves, and watches files — no AI logic in the extension.

## Decisions

- **architecture.excalidraw** answers: **who owns each part, and what IO flows between them?**
- Legend first; shapes match legend. Flow subtitle: write → watch → load → change → save.
- Agents write disk directly. Human paints into hosts. Hosts load runtime + autosave disk.
- Hosts = one rect (`ide · rust`). Runtime = ellipse (`excalidraw` / `js`). Build off-canvas.
- Default popup: Rust applet. Shared webview: `extension/webview` → `media` + `viewer/dist`.

## Visual Preferences

- **Legend question:** Who owns each part? What flows between them?
- **Shapes:** Client yellow · Disk green · Host outline · Runtime gray ellipse.
- **Arrows:** Solid ↓ = forward IO (write / watch / paint). Dashed = load scene + return path (change / autosave) on right elbow.
- **IO on boxes:** short `IN` / `OUT` lines inside shapes. Arrow labels name payload (`write JSON`, `scene JSON`, …).
- **Layout:** agents → disk → hosts(+human side) → runtime. Gaps ~110px. Main draw x ≥ 300.
- **Avoid:** swimlanes, build row, Electron, arrow-through-disk, unlabeled arrows.

## Interaction Preferences

- Prefer patches over complete rewrites.
- Never delete user work without confirmation.
- When a request conflicts with saved metadata or diagram state, ask before changing.
- Offer numbered options before adding a new diagram object; wait for the user's choice.
- Ask before opening the diagram applet in terminal harnesses unless user opts out.

## Learned Preferences

- User wants flow + IO on relevant parts, not ownership boxes alone.
- Prefers hosts grouped + JS ellipse. Dislikes short/random arrows.

## Saved Components
