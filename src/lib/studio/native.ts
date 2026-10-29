/**
 * Renderer-side native API detection. When the app runs inside Electron, the
 * preload script exposes `window.studio` (a strictly typed, validated surface).
 * In the web preview, `window.studio` is undefined and the app falls back to
 * the in-browser Web Audio engine. No feature pretends to be native when it
 * isn't.
 */

import type { StudioNativeApi } from "./ipc-contracts";

declare global {
  interface Window {
    studio?: StudioNativeApi;
  }
}

/** True only when running inside Electron with the secure preload bridge. */
export function isNative(): boolean {
  return typeof window !== "undefined" && !!window.studio && window.studio.isNative === true;
}

/** Access the native API; returns undefined in the web preview. */
export function native(): StudioNativeApi | undefined {
  return typeof window !== "undefined" ? window.studio : undefined;
}
