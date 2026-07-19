# Applet cold-start latency — Electron

## Context

Electron applet (`viewer/applet/`) time to interactive diagram. Baseline for Rust/wry comparison (Jul 2026).

## Environment

| Item | Value |
|------|-------|
| Machine | Apple M4 Pro, macOS 15.5 |
| Node | v22.12.0 |
| Electron | ^33.2.1 |
| Diagram | `architecture.excalidraw` (13 KB) |
| Webview bundle | `viewer/dist/webview.js` (8.0 MB, minified) |

## Method

Instrumentation in `viewer/applet/main.mjs` (`DDD_APPLET_TIMING=1`) and `extension/webview/src/App.tsx` (posts `timing` / `diagram-render` when Excalidraw payload mounts). Five sequential cold starts; each process exits on first render (`DDD_APPLET_BENCHMARK=1`).

```bash
cd viewer
for i in 1 2 3 4 5; do
  DDD_APPLET_TIMING=1 DDD_APPLET_BENCHMARK=1 \
    node node_modules/electron/cli.js applet/main.mjs ../architecture.excalidraw
done
```

Wall-clock from process start to `diagram-render`.

## Results

### Time to interactive (diagram-render)

| Run | ms |
|-----|-----|
| 1 | 272 |
| 2 | 267 |
| 3 | 266 |
| 4 | 261 |
| 5 | 261 |

| Stat | ms |
|------|-----|
| Min | 261 |
| Max | 272 |
| Mean | 265 |
| Median | 266 |

### Phase breakdown (typical run)

| Phase | ms (approx) |
|-------|-------------|
| `app-ready` | 20 |
| `session-init` | 29 |
| `window-created` | 68 |
| `load-file-called` | 71 |
| `dom-ready` | 235 |
| **`diagram-render`** | **261–272** |

## Notes

- Sync preload inject (`__DDD_INITIAL_DIAGRAM__`) avoids IPC wait for first paint.
- Most cost is 8 MB webview bundle parse after `dom-ready`.
