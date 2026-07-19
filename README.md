# Design Drive Development (DDD)

Architecture diagrams in your repo that your Cursor agent can edit — file on disk is truth. Excalidraw today; Mermaid planned.

## Repository layout

```
architecture.excalidraw          # sample diagram
architecture.metadata.md         # persistent diagram knowledge
extension/                       # VS Code / Cursor extension
.cursor/skills/design-drive-development/
```

## Quick start

### 1. Build and install the extension (once)

```bash
cd extension
npm install
npm run install:local
```

Reload Cursor when prompted. This installs **Design Drive Development (DDD)** into your main Cursor window (not only the Extension Development Host).

To rebuild after code changes: `npm run install:local` again.

### 2. Open a diagram

1. Close any open `architecture.excalidraw` tab.
2. Reopen it — should use **Design Drive Development (DDD)** (see editor tab title).

`.vscode/settings.json` maps `*.excalidraw` to our editor. Disable `pomdtr.excalidraw-editor` if it still wins.

External edits (agent or disk) reload within ~400ms via webview pull + file watcher.

### Copy selection for chat

1. Select elements in the diagram.
2. Press **Cmd+C** (or **Copy Selection Reference for Chat** / `Shift+Alt+C`).
3. Paste into Cursor chat — e.g. `@architecture.excalidraw:602-650 · Circle 9`

### Save and insert design groups

Reusable groups are stored in `.designs/groups/*.excalidraw-group.json`.

1. Select elements → **Save Selection as Design** (`Shift+Alt+S`) → name it.
2. First save prompts to create `.designs/` (separate repo branch for components).
3. **Insert Design from Repository** (`Shift+Alt+I`) → pick a saved group.

**Troubleshooting live reload:** After `install:local`, run **Developer: Reload Window**. Confirm tab title is **Design Drive Development (DDD)**. Open **View → Output → Design Drive Development (DDD)** — you should see `pushed external update` lines when the agent edits the file.

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

- Diagram file on disk is source of truth
- Extension: open, save, watch, render — no AI logic
- Cursor skill: read, edit, metadata, interaction menu
- No server, no custom sync protocol

## Manual loop test

1. Open `architecture.excalidraw` in the extension.
2. Ask the agent to split a service.
3. Watch the diagram update when the agent saves the file.
4. Drag a box manually.
5. Tell the agent: `2` (you edited it).
6. Agent re-reads the file and continues.

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
