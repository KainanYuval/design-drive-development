import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const outdir = "media";

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["webview/src/main.tsx"],
  bundle: true,
  outfile: `${outdir}/webview.js`,
  format: "iife",
  platform: "browser",
  target: ["chrome114"],
  jsx: "automatic",
  conditions: ["production", "import", "default"],
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".css": "css",
    ".woff2": "file",
    ".woff": "file",
    ".svg": "file",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: true,
  sourcemap: false,
  logLevel: "info",
});

console.log(`Webview bundle written to ${outdir}/webview.js`);
