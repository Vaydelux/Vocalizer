#!/usr/bin/env node
/**
 * Cross-platform Next.js static export for the Electron renderer.
 *
 * Calling "next.cmd" relies on the package manager creating a Windows shim
 * and exporting it on PATH. Bun on Windows does not always do that. Launch the
 * installed Next.js CLI through the current Node executable instead.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const nextCli = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "build"], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, ELECTRON_BUILD: "1" },
});

child.on("error", (error) => {
  console.error("Cannot start Next.js static export:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) console.error(`Next.js export terminated by signal ${signal}`);
  process.exitCode = code ?? 1;
});
