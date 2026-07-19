#!/usr/bin/env node
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage: node viewer/view.mjs <diagram.excalidraw> [--open]

  Opens the Design Drive Development diagram applet (standalone Electron window).
  Not Cursor, not a browser tab — a separate desktop window with live reload.

  --open   Launch the applet (default without --open: print command only)`);
}

function parseArgs(argv) {
  const positional = [];
  let open = false;

  for (const arg of argv) {
    if (arg === "--open") {
      open = true;
      continue;
    }
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    usage();
    process.exit(1);
  }

  const diagramPath = resolve(positional[0]);
  if (extname(diagramPath) !== ".excalidraw") {
    throw new Error("Expected a .excalidraw file");
  }

  return { diagramPath, open };
}

function electronBinary() {
  const local = join(here, "node_modules", "electron", "cli.js");
  if (existsSync(local)) {
    return { node: process.execPath, args: [local] };
  }
  throw new Error(
    "Electron not installed. Run: cd viewer && npm install && cd ../extension && npm run build:applet"
  );
}

async function main() {
  const { diagramPath, open } = parseArgs(process.argv.slice(2));

  try {
    await stat(diagramPath);
  } catch {
    throw new Error(`File not found: ${diagramPath}`);
  }

  try {
    accessSync(join(here, "applet", "main.mjs"), constants.R_OK);
    accessSync(join(here, "dist", "webview.js"), constants.R_OK);
    accessSync(join(here, "dist", "index.html"), constants.R_OK);
  } catch {
    throw new Error("Applet not built. Run: cd extension && npm run build:applet");
  }

  const appletMain = join(here, "applet", "main.mjs");
  const { node, args: electronArgs } = electronBinary();
  const launchArgs = [...electronArgs, appletMain, diagramPath];

  if (!open) {
    console.log("[ddd-applet] launch command (pass --open to run):");
    console.log(`  ${node} ${launchArgs.join(" ")}`);
    return;
  }

  console.log(`[ddd-applet] opening desktop window → ${diagramPath}`);

  const child = spawn(node, launchArgs, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });

  child.unref();
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
