/**
 * Produce a single sandbox-compatible preload. Electron sandboxed preload
 * scripts cannot require local files or arbitrary node_modules at runtime.
 * Supports running under both Bun and Node.js.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const outDir = path.resolve("./electron/dist/preload");
const outFile = path.join(outDir, "index.js");

if (typeof Bun !== "undefined") {
  const output = await Bun.build({
    entrypoints: ["./electron/preload/index.ts"],
    outdir: "./electron/dist/preload",
    naming: "index.js",
    target: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: "none",
  });

  if (!output.success || output.outputs.length !== 1) {
    for (const log of output.logs) console.error(log);
    throw new Error("Sandboxed Electron preload bundling failed.");
  }
  console.log("Preload bundle created:", output.outputs[0].path);
} else {
  // Try bun on PATH or ~/.local/bin/bun
  const bunPath = process.env.PATH?.split(":").map(p => path.join(p, "bun")).find(p => fs.existsSync(p)) ||
    (fs.existsSync(path.join(process.env.HOME || "", ".local/bin/bun")) ? path.join(process.env.HOME || "", ".local/bin/bun") : null);

  if (bunPath) {
    const res = spawnSync(bunPath, ["run", "./scripts/build-preload.mjs"], { stdio: "inherit" });
    if (res.status !== 0) process.exit(res.status ?? 1);
  } else {
    // Fallback: Inline compiled dependencies into a standalone CommonJS bundle
    fs.mkdirSync(outDir, { recursive: true });
    const compiledPreload = path.resolve("./electron/dist/preload/index.js");
    const compiledIpc = path.resolve("./electron/dist/shared/ipc.js");
    if (!fs.existsSync(compiledPreload) || !fs.existsSync(compiledIpc)) {
      throw new Error("Compile electron typescript first with tsc -p electron/tsconfig.json");
    }
    const ipcContent = fs.readFileSync(compiledIpc, "utf8");
    const preloadContent = fs.readFileSync(compiledPreload, "utf8");
    // Bundle ipc into preload
    const bundled = `
"use strict";
var exports = {};
var module = { exports: exports };
(function() {
${ipcContent}
})();
var ipc_1 = module.exports;
${preloadContent.replace(/const ipc_1 = require\("\.\.\/shared\/ipc"\);/, "")}
`;
    fs.writeFileSync(outFile, bundled, "utf8");
    console.log("Preload bundle created (Node fallback):", outFile);
  }
}
