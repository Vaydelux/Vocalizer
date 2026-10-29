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

function migrateSettings(persisted: unknown): SettingsJson {
  const validated = validateSettingsJson(persisted);
  if (validated) {
    // Forward-fill any keys added by newer versions.
    return { ...DEFAULT_SETTINGS, ...validated } as SettingsJson;
  }
  return { ...DEFAULT_SETTINGS } as SettingsJson;
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
        const validated = validateSettingsJson({
          theme: state.theme,
          accent: state.accent,
          exportFormat: state.exportFormat,
          sampleRate: state.sampleRate,
          concurrency: state.concurrency,
          volume: state.volume,
          preferredModelId: state.preferredModelId,
          fallbackPolicy: state.fallbackPolicy,
        });
        if (!validated) {
          // Persisted state failed validation — restore defaults.
          useSettings.setState({ ...DEFAULT_SETTINGS });
        }
      },
    }
  )
);
