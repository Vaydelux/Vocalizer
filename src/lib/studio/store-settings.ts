"use client";

/**
 * Persisted settings store. Every persisted JSON is re-validated with Zod on
 * load; corrupt or incompatible data falls back to defaults (corruption
 * recovery), and `version` + `migrate` provide the schema-migration seam.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { validateSettingsJson, type SettingsJson } from "./schemas";
import type { StudioSettings } from "./types";

export const DEFAULT_SETTINGS: StudioSettings = {
  theme: "dark",
  accent: "violet",
  exportFormat: "wav16",
  mp3Bitrate: 192,
  sampleRate: "auto",
  concurrency: 1,
  volume: 0.8,
  preferredModelId: null,
  fallbackPolicy: "cpu-then-embedded",
};

interface SettingsStore extends StudioSettings {
  update: (patch: Partial<StudioSettings>) => void;
  reset: () => void;
}

/** Merge legacy versions with defaults BEFORE full schema validation. */
export function migrateSettings(persisted: unknown): SettingsJson {
  const candidate =
    persisted !== null && typeof persisted === "object" && !Array.isArray(persisted)
      ? { ...DEFAULT_SETTINGS, ...persisted }
      : { ...DEFAULT_SETTINGS };
  return validateSettingsJson(candidate) ?? { ...DEFAULT_SETTINGS };
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set((s) => ({ ...s, ...patch })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "local-audio-studio.settings",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => migrateSettings(persisted),
      // Validate everything that comes back from storage.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Validate the complete settings object. Explicitly rebuilding a
        // partial object dropped mp3Bitrate, making *every* hydration fail
        // and silently restoring all preferences to their defaults.
        // Zod strips Zustand action functions and other unknown keys.
        const validated = validateSettingsJson(state);
        if (!validated) {
          // Persisted state failed validation — restore defaults.
          useSettings.setState({ ...DEFAULT_SETTINGS });
        }
      },
    }
  )
);
