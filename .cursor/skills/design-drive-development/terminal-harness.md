# Terminal harness — popup viewer (opt-in)

Port this section into Pi, Claude Code, Hermes, and other terminal-only agent configs.

## When this applies

The user works in a **terminal harness** — not Cursor/VS Code with the DDD extension open on the diagram.

## Before the first diagram edit in a session

Check metadata **Interaction Preferences** for `Popup viewer: do not ask`.

Otherwise **ask**:

```text
Terminal agent — .excalidraw isn't visual here.

Open the DDD diagram applet (standalone desktop window)?

1 — Yes, open applet now
2 — No, continue without popup this session
3 — No, and don't ask again (save to metadata)
4 — Already open
```

| Choice | Action |
|--------|--------|
| **1** | `cd extension && npm run view -- <diagram-path> --open` |
| **3** | Save `Popup viewer: do not ask (terminal harness).` in metadata |

**Never** use `--open` without user opt-in.

## Manual launch

```bash
cd extension
npm run build:applet   # once — copies webview bundle to viewer/dist/
npm run build:rust-applet   # once — cargo build --release
npm run view -- ../architecture.excalidraw --open
```

Opens a **separate Rust desktop window** (not Cursor). Live reload when the file changes on disk.
