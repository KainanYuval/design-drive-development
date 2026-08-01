#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$(cd "$ROOT/.." && pwd)}"
VSIX=( "$ROOT"/extension/*.vsix )

if [[ ! -f "${VSIX[0]:-}" ]]; then
  echo "No VSIX in $ROOT/extension — run: npm run ship" >&2
  exit 1
fi

if command -v cursor >/dev/null 2>&1; then
  cursor --install-extension "${VSIX[0]}" --force
elif command -v code >/dev/null 2>&1; then
  code --install-extension "${VSIX[0]}" --force
else
  echo "Install cursor or code CLI, or: cursor --install-extension ${VSIX[0]}" >&2
  exit 1
fi

mkdir -p "$TARGET/.cursor/skills"
rm -rf "$TARGET/.cursor/skills/design-drive-development"
cp -R "$ROOT/skills/design-drive-development" "$TARGET/.cursor/skills/design-drive-development"

echo "Installed ${VSIX[0]##*/}"
echo "Copied skill → $TARGET/.cursor/skills/design-drive-development"
echo "Reload Cursor, then open a .excalidraw file with Design Drive Development (DDD)."
