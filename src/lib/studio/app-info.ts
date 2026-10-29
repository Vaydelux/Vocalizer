/** Application identity constants — single source of truth. */

export const APP_NAME = "Local Audio Studio";
export const APP_VERSION = "0.1.0";
/** Milestone label used in diagnostics: Phase 1 shell + Phase 2 core audio. */
export const APP_MILESTONE = "Phase 1 + Phase 2 milestone (web preview runtime)";

export const RUNTIME_INFO = {
  /** Honest labels: this preview runs in a browser, not Electron. */
  desktop: "N/A in web preview (populated by the Electron build)",
  engine: "Web Audio API + custom canvas waveform renderer + OfflineAudioContext",
} as const;
