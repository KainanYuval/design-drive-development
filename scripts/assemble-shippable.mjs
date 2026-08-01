#!/usr/bin/env node
/**
 * Build extension + applets and assemble shippable/ distribution bundle.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const shippable = join(root, "shippable");
const extensionDir = join(root, "extension");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyDir(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function copyFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

console.log("[shippable] compile + test extension…");
run("npm", ["run", "test"], extensionDir);

console.log("[shippable] build extension + webview + applet dist…");
run("npm", ["run", "build"], extensionDir);

console.log("[shippable] package VSIX…");
run("npm", ["run", "package"], extensionDir);

const vsixFiles = readdirSync(extensionDir).filter((name) => name.endsWith(".vsix"));
if (vsixFiles.length === 0) {
  console.error("[shippable] no .vsix produced in extension/");
  process.exit(1);
}
const vsixName =
  vsixFiles.find((name) => name.startsWith("design-drive-development-")) ??
  vsixFiles.toSorted().at(-1);
if (!vsixName) {
  console.error("[shippable] could not resolve VSIX name");
  process.exit(1);
}

console.log("[shippable] build Rust applet (release)…");
const rustResult = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", join(root, "viewer/rust/Cargo.toml")],
  { cwd: root, stdio: "inherit" }
);
const rustBuilt = rustResult.status === 0;

console.log("[shippable] assemble tree…");
rmSync(shippable, { recursive: true, force: true });
mkdirSync(shippable, { recursive: true });

const targets = {
  extension: join(shippable, "extension"),
  skills: join(shippable, "skills", "design-drive-development"),
  viewerDist: join(shippable, "viewer", "dist"),
  viewerSync: join(shippable, "viewer", "sync"),
  viewerApplet: join(shippable, "viewer", "applet"),
  mechanisms: join(shippable, "mechanisms"),
};

mkdirSync(targets.extension, { recursive: true });
copyFile(join(extensionDir, vsixName), join(targets.extension, vsixName));

copyDir(join(root, ".cursor/skills/design-drive-development"), targets.skills);

copyDir(join(root, "viewer/dist"), targets.viewerDist);
mkdirSync(targets.viewerSync, { recursive: true });
for (const file of ["syncCoordinator.js", "agentTurn.js"]) {
  copyFile(join(extensionDir, "out", file), join(targets.viewerSync, file));
}

mkdirSync(targets.viewerApplet, { recursive: true });
for (const file of ["hostSession.mjs", "main.mjs"]) {
  copyFile(join(root, "viewer/applet", file), join(targets.viewerApplet, file));
}
copyFile(join(root, "viewer/view.mjs"), join(targets.viewerApplet, "view.mjs"));
copyFile(join(root, "viewer/view-rust.mjs"), join(targets.viewerApplet, "view-rust.mjs"));

if (rustBuilt) {
  const rustBin =
    process.platform === "win32"
      ? join(root, "viewer/rust/target/release/ddd-applet-rust.exe")
      : join(root, "viewer/rust/target/release/ddd-applet-rust");
  if (existsSync(rustBin)) {
    copyFile(rustBin, join(shippable, "viewer", "ddd-applet-rust"));
  }
}

mkdirSync(targets.mechanisms, { recursive: true });
copyFile(
  join(root, ".cursor/skills/design-drive-development/bindings-and-captions.md"),
  join(targets.mechanisms, "bindings-and-captions.md")
);
writeFileSync(
  join(targets.mechanisms, "agent-turn.md"),
  `# Agent turn lock

Create \`<diagram>.excalidraw.ddd-agent-turn.lock\` before the first agent disk write in a design turn; delete when done.

\`\`\`json
{
  "kind": "agent-turn",
  "label": "Agent turn",
  "pid": 0,
  "startedAt": "2026-08-01T13:00:00.000Z"
}
\`\`\`

While the lock exists, open DDD hosts show a red banner, pause human canvas input, reload disk at ~16ms, and apply agent writes live.

Also wait while \`<diagram>.ddd-write.lock\` exists (human save in progress).
`,
  "utf8"
);

writeFileSync(
  join(targets.mechanisms, "README.md"),
  `# DDD mechanisms (shippable)

| File | Purpose |
|------|---------|
| [agent-turn.md](agent-turn.md) | \`.ddd-agent-turn.lock\` — live agent edits, human paused |
| [bindings-and-captions.md](bindings-and-captions.md) | Arrows/lines stay attached; labels inside shapes |

Full agent workflow: \`../skills/design-drive-development/SKILL.md\`
`,
  "utf8"
);

const extensionPkg = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const manifest = {
  name: "design-drive-development-shippable",
  version: extensionPkg.version,
  assembledAt: new Date().toISOString(),
  vsix: vsixName,
  rustApplet: rustBuilt && existsSync(join(shippable, "viewer", "ddd-applet-rust")),
  contents: {
    extension: relative(root, join(targets.extension, vsixName)),
    skills: relative(root, targets.skills),
    viewerDist: relative(root, targets.viewerDist),
    viewerSync: relative(root, targets.viewerSync),
    mechanisms: relative(root, targets.mechanisms),
  },
};
writeFileSync(join(shippable, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

writeFileSync(
  join(shippable, "__context__.md"),
  `Pre-built DDD distribution: VSIX extension, Cursor agent skill, viewer bundles, sync modules, and lock/binding mechanism docs.
Run \`node scripts/assemble-shippable.mjs\` from repo root to refresh; \`shippable/install.sh\` installs into a target project or Cursor.
`,
  "utf8"
);

const templates = join(root, "scripts/shippable-templates");
writeFileSync(join(shippable, "README.md"), readFileSync(join(templates, "README.template.md"), "utf8"));
writeFileSync(join(shippable, "install.sh"), readFileSync(join(templates, "install.template.sh"), "utf8"), {
  mode: 0o755,
});

console.log(`[shippable] done → ${relative(root, shippable)}/ (${vsixName})`);
