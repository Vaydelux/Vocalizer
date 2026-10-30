/** Application identity constants — keep in sync with package.json. */
export const APP_NAME = "Vocalizer";
export const APP_VERSION = "0.3.0";
export const APP_MILESTONE = "Windows x64 debug preview — offline model not bundled";

export const RUNTIME_INFO = {
  desktop: "Electron desktop runtime (when preload is available)",
  engine: "Web Audio for preview; Electron/FFmpeg and optional local inference on desktop",
} as const;
