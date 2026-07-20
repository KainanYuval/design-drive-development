# Architecture Metadata

## Constraints

- `.excalidraw` JSON on disk is the only shared state; no duplicate sync layer.
- Extension renders, autosaves, and watches files — no AI logic in the extension.

## Decisions

- Default standalone viewer: Rust applet (`npm run view --open`).
- Electron applet kept as fallback (`npm run view:electron --open`).
- Shared webview bundle: `extension/webview` → `extension/media` + `viewer/dist`.

## Visual Preferences

- **Legend (required):** compact panel upper-left (~24,24); one row per shape/color used; swatches match element fills exactly; main diagram starts at x ≥ 300.
- **This diagram (DDD repo):** yellow = author/agent; green = file on disk; blue = Cursor extension; orange = Rust applet (default); purple = Electron applet; gray = shared Excalidraw webview; dark arrows = watch / autosave / load.
- Rounded rectangles for hosts and storage; roughness 0 on legend and labels.
- Horizontal layout for primary data flow.

## Interaction Preferences

- Prefer patches over complete rewrites.
- Never delete user work without confirmation.
- When a request conflicts with saved metadata or diagram state, ask before changing.
- Offer numbered options before adding a new diagram object; wait for the user's choice.
- Ask before opening the diagram applet in terminal harnesses unless user opts out.

## Learned Preferences

- User dislikes crossing arrows.
- Legend must look intentional — readable swatches, short labels, not cramped.

## Saved Components
