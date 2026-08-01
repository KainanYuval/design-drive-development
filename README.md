# Design Drive Development (DDD)

Architecture diagrams in your repo that humans and agents can edit. Disk is durable interchange; an open editor protects human work. Excalidraw today; Mermaid planned.

## Repository layout

```
architecture.excalidraw          # sample diagram
architecture.metadata.md         # persistent diagram knowledge
extension/                       # VS Code / Cursor extension
.cursor/skills/design-drive-development/
```

## Quick start

### 1. Build and install the extension (once)

**From source (developers):**

```bash
cd extension
npm install
npm run install:local
```

**From shippable bundle:**

```bash
./shippable/install.sh
```

Reload Cursor when prompted. This installs **Design Drive Development (DDD)** into your main Cursor window (not only the Extension Development Host).

To rebuild after code changes: `npm run install:local` again, or refresh the bundle with `npm run ship` from repo root.

### 2. Open a diagram

1. Close any open `architecture.excalidraw` tab.
2. Reopen it — should use **Design Drive Development (DDD)** (see editor tab title).

`.vscode/settings.json` maps `*.excalidraw` to our editor. Disable `pomdtr.excalidraw-editor` if it still wins.

External edits (agent or disk) reload via file watcher. Each load carries a generation and is committed only after the canvas acknowledges it.

Partially typed or otherwise invalid JSON is ignored; the canvas keeps its last valid revision and reloads after the file becomes valid again. Only a zero-byte file is seeded as a new blank diagram on first open.

### Copy selection for chat

1. Select elements in the diagram.
2. Press **Cmd+C** (or **Copy Selection Reference for Chat** / `Shift+Alt+C`).
3. Paste into Cursor chat — e.g. `@architecture.excalidraw:602-650 · Circle 9`

### Save and insert design groups

Reusable groups are stored in `.designs/groups/*.excalidraw-group.json`.

1. Select elements → **Save Selection as Design** (`Shift+Alt+S`) → name it.
2. First save prompts to create `.designs/` (separate repo branch for components).
3. **Insert Design from Repository** (`Shift+Alt+I`) → pick a saved group.

**Troubleshooting live reload:** After `install:local`, run **Developer: Reload Window**. Confirm tab title is **Design Drive Development (DDD)**. Open **View → Output → Design Drive Development (DDD)** — you should see `load generation` and `loadApplied` lines when an agent edit reaches the canvas.

### 3. Collaborate with the agent

Ask Cursor to review or change the architecture, for example:

> Review the architecture.

> Split the auth service.

The agent should use the `design-drive-development` skill: read the `.excalidraw` file and metadata, patch the diagram, save, and end with the accept/reject menu. The extension reloads automatically.

### Popup applet (terminal harnesses — opt-in)

Terminal agents cannot show `.excalidraw` in the shell. On opt-in, **`npm run view --open`** opens a **standalone Electron window** — not Cursor, not a browser tab. Same Excalidraw view + live reload on file changes.

```bash
cd extension
npm run build:applet   # once
npm run view -- ../architecture.excalidraw --open
```

Agent must ask before `--open`. See `terminal-harness.md`.

## Principles

- Diagram file on disk is durable shared representation
- Open editor host owns writes while human canvas has uncommitted changes
- Synced agent writes load live; concurrent agent versions are preserved as `*.agent-conflict.excalidraw`
- Extension: open, save, watch, arbitrate revisions, render — no AI logic
- Cursor skill: read, edit, metadata, interaction menu
- No server; host/webview sync uses generation-aware messages and compare-and-swap saves

## Two-way ownership

Normal path: human edits autosave after 300ms; agent reads that file. Agent edits made while canvas is synced appear live. Hosts use a short-lived `<diagram>.ddd-write.lock`; cooperative agents wait, re-read, then write.

Conflict path: if an agent writes while the human canvas is dirty, human work stays visible and wins the main file. Agent content is saved beside it as `<name>.agent-conflict.excalidraw` with hash metadata. Cursor offers to open or replace with that candidate. Nothing is silently discarded.

## Manual loop test

1. Open `architecture.excalidraw` in the extension.
2. Ask the agent to split a service.
3. Watch the diagram update when the agent saves the file.
4. Drag a box manually.
5. Confirm the drag remains after autosave/watch echo.
6. Ask the agent to edit while the canvas is idle; confirm live reload.
7. Edit continuously while an agent writes; confirm human canvas stays and agent candidate is preserved.

## Package extension (optional)

```bash
cd extension
npx @vscode/vsce package
```

Install the resulting `.vsix` in Cursor via **Extensions → Install from VSIX**.

## License & security

- [MIT](LICENSE) — see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) for Excalidraw and dependencies
- Report vulnerabilities via [SECURITY.md](SECURITY.md) (no public issues for security)
- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md)
