/**
 * Build one sandbox-compatible preload bundle using Bun's actual bundler.
 * Never concatenate TypeScript/CommonJS modules by hand: that previously
 * produced an invalid bridge in packaged Windows builds.
 * electron:compile invokes this script from Node, not Bun.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bunName = process.platform === "win32" ? "bun.exe" : "bun";
const bunPath = (process.env.PATH ?? "")
  .split(path.delimiter)
  .filter(Boolean)
  .map((folder) => path.join(folder, bunName))
  .find((candidate) => fs.existsSync(candidate));

if (!bunPath) {
  throw new Error("Bun must be installed and on PATH to bundle the Electron preload.");
}

const outFile = path.resolve("electron/dist/preload/index.js");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const result = spawnSync(
  bunPath,
  ["build", "./electron/preload/index.ts", "--outfile", outFile,
    "--target", "node", "--format", "cjs", "--external", "electron"],
  { cwd: process.cwd(), stdio: "inherit", shell: false }
);
if (result.error || result.status !== 0) {
  throw new Error("Bundling the sandbox preload failed: " + (result.error?.message ?? result.status));
}

const bundled = fs.readFileSync(outFile, "utf8");
if (!bundled.includes("exposeInMainWorld") ||
    /require\(["']\.\.\/shared\/ipc["']\)/.test(bundled)) {
  throw new Error("Preload bundle is incomplete or refers to an unpackaged local dependency.");
}
console.log("Verified sandbox preload bundle:", outFile);
