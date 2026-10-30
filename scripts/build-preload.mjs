/**
 * Produce a single sandbox-compatible preload. Electron sandboxed preload
 * scripts cannot require local files or arbitrary node_modules at runtime.
 * Programmatic Bun.build avoids cross-platform CLI flag parsing differences.
 */
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
