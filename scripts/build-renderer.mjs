#!/usr/bin/env node
/**
 * Cross-platform renderer build for the Electron desktop bundle.
 *
 * `ELECTRON_BUILD=1 next build` is POSIX-only (it does not work in cmd.exe or
 * PowerShell without a Unix-style shell). This script sets the env var in a
 * portable way and runs `next build`, producing the static export in `out/`.
 *
 * Run it on the Windows build host before `electron-builder`.
 */
import { spawn } from "node:child_process";

process.env.ELECTRON_BUILD = "1";

const child = spawn(
  process.platform === "win32" ? "next.cmd" : "next",
  ["build"],
  { stdio: "inherit", shell: process.platform === "win32" }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
