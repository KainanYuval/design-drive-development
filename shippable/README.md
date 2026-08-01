# Design Drive Development — shippable bundle

Pre-built artifacts for installing DDD without running the full dev build chain.

## Contents

| Path | What |
|------|------|
| `extension/*.vsix` | Cursor / VS Code extension (compiled host + webview) |
| `skills/design-drive-development/` | Agent skill (workflow, bindings, agent turn, format) |
| `viewer/dist/` | Shared Excalidraw webview bundle for applets |
| `viewer/sync/` | Host sync modules (`syncCoordinator.js`, `agentTurn.js`) |
| `viewer/applet/` | Electron applet entry + view scripts |
| `viewer/ddd-applet-rust` | Rust standalone viewer (when built on this platform) |
| `mechanisms/` | Agent turn lock + bindings/captions quick reference |
| `MANIFEST.json` | Assembly metadata |

## Refresh bundle (maintainers)

From repo root:

```bash
npm run ship
```

Runs extension tests, builds webview + applet dist, packages VSIX, and copies skills/mechanisms here.

## Install (consumers)

From repo root (or pass target project path):

```bash
./shippable/install.sh
# or
./shippable/install.sh /path/to/your/project
```

This installs the VSIX into Cursor and copies the agent skill into the target's `.cursor/skills/`.

## Manual install

```bash
cursor --install-extension shippable/extension/design-drive-development-*.vsix --force
cp -R shippable/skills/design-drive-development /path/to/project/.cursor/skills/
```

Reload Cursor after installing the extension.
