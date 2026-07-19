# Applet cold-start latency — Rust/wry

## Context

Rust alternative applet (`viewer/rust/`, wry + tao) reusing the same `viewer/dist/` webview bundle. Compare cold-start vs Electron on identical diagram/assets.

## Environment

| Item | Value |
|------|-------|
| Machine | Apple M4 Pro, macOS 15.5 |
| Rust | 1.96.0 (Homebrew) |
| wry | 0.47.2 |
| tao | 0.30.8 |
| Diagram | `architecture.excalidraw` (13 KB) |
| Webview bundle | `viewer/dist/webview.js` (8.0 MB, minified) |

## Method

Same webview timing hook (`diagram-render` IPC). Rust marks in `viewer/rust/src/timing.rs` / `main.rs`. Five cold starts; exit on render (`DDD_APPLET_BENCHMARK=1`).

```bash
cd viewer/rust
cargo build --release
for i in 1 2 3 4 5; do
  DDD_APPLET_TIMING=1 DDD_APPLET_BENCHMARK=1 \
    ./target/release/ddd-applet-rust ../../architecture.excalidraw
done
```

Launch for normal use: `node viewer/view-rust.mjs <file.excalidraw> --open`

## Results

### Time to interactive (diagram-render)

| Run | ms |
|-----|-----|
| 1 | 299 |
| 2 | 290 |
| 3 | 293 |
| 4 | 279 |
| 5 | 295 |

| Stat | ms |
|------|-----|
| Min | 279 |
| Max | 299 |
| Mean | 291 |
| Median | 293 |

Also under **300 ms** on this machine.

### Phase breakdown (typical run)

| Phase | ms (approx) |
|-------|-------------|
| `session-init` | 0 |
| `window-created` | 60 |
| `load-file-called` | 110 |
| `app-ready` | 110 |
| `dom-ready` | 293 |
| **`diagram-render`** | **279–299** |

## Comparison vs Electron (same session)

| Backend | Mean | Min | Max |
|---------|------|-----|-----|
| Electron | 265 ms | 261 ms | 272 ms |
| Rust/wry | 291 ms | 279 ms | 299 ms |

Delta ~**+26 ms mean** — same 8 MB JS parse dominates; Rust shell slightly slower here (WKWebView init + custom protocol). Not a win on cold start for this stack.

## Notes

- Custom protocol URL must be `ddd://localhost/...` (not `http://ddd.local/...`) or assets fail silently.
- Init script injects `__DDD_INITIAL_DIAGRAM__` + `acquireVsCodeApi` bridge to `window.ipc.postMessage`.
- Release binary ~few MB vs Electron ~150 MB+ runtime footprint (not measured here).
