import type { NextConfig } from "next";

/**
 * The web preview/dev server uses `standalone`. When the desktop bundle is
 * built (`ELECTRON_BUILD=1`), Next emits a static export to `out/` that Electron
 * loads via `file://` — no dev server dependency in production.
 */
const isElectronBuild = process.env.ELECTRON_BUILD === "1";

const nextConfig: NextConfig = {
  output: isElectronBuild ? "export" : "standalone",
  // Static export requires unoptimized images (no server image optimizer).
  images: isElectronBuild ? { unoptimized: true } : undefined,
  // A release build must fail on TypeScript errors; do not mask failures.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
