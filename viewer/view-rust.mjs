#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants, existsSync, accessSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage: node viewer/view-rust.mjs <diagram.excalidraw> [--open]

  Opens the Design Drive Development diagram applet (Rust/wry desktop window).

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

function rustBinary() {
  const release = join(here, "rust", "target", "release", "ddd-applet-rust");
  const debug = join(here, "rust", "target", "debug", "ddd-applet-rust");
  if (existsSync(release)) {
    return release;
  }
  if (existsSync(debug)) {
    return debug;
  }
  throw new Error(
    "Rust applet not built. Run: cd viewer/rust && cargo build --release"
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
    accessSync(join(here, "dist", "webview.js"), constants.R_OK);
    accessSync(rustBinary(), constants.X_OK);
  } catch {
    throw new Error(
      "Applet not ready. Run: cd extension && npm run build:applet && cd ../viewer/rust && cargo build --release"
    );
  }

  const binary = rustBinary();
  const launchArgs = [diagramPath];

  if (!open) {
    console.log("[ddd-applet-rust] launch command (pass --open to run):");
    console.log(`  ${binary} ${launchArgs.join(" ")}`);
    return;
  }

  console.log(`[ddd-applet-rust] opening desktop window → ${diagramPath}`);

  const child = spawn(binary, launchArgs, {
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
