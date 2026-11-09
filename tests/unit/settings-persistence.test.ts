import { describe, expect, it } from "bun:test";
import { validateSettingsJson } from "../../src/lib/studio/schemas";
import { DEFAULT_SETTINGS, migrateSettings } from "../../src/lib/studio/store-settings";

describe("settings persistence and hydration", () => {
  it("accepts complete user preferences even when Zustand actions are present", () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      theme: "light" as const,
      exportFormat: "mp3" as const,
      mp3Bitrate: 320 as const,
      volume: 0.35,
    };
    // Zustand's live store has methods as well as the persisted data.
    // Hydration must validate ALL settings, including mp3Bitrate.
    expect(validateSettingsJson({ ...saved, update: () => {}, reset: () => {} }))
      .toEqual(saved);
  });

  it("forward-fills an older settings payload without discarding known choices", () => {
    const migrated = migrateSettings({
      theme: "light",
      volume: 0.4,
      exportFormat: "mp3",
    });
    expect(migrated).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
      volume: 0.4,
      exportFormat: "mp3",
    });
    expect(migrated.mp3Bitrate).toBe(DEFAULT_SETTINGS.mp3Bitrate);
  });

  it("preserves selected MP3 bitrate and concurrency through migrations", () => {
    const migrated = migrateSettings({
      ...DEFAULT_SETTINGS,
      theme: "light",
      mp3Bitrate: 256,
      concurrency: 2,
      volume: 0,
    });
    expect(migrated.mp3Bitrate).toBe(256);
    expect(migrated.concurrency).toBe(2);
    expect(migrated.volume).toBe(0);
    expect(migrated.theme).toBe("light");
  });

  it("recovers to validated defaults for malformed or unsafe settings", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ ...DEFAULT_SETTINGS, volume: 7 }))
      .toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ ...DEFAULT_SETTINGS, mp3Bitrate: -1 }))
      .toEqual(DEFAULT_SETTINGS);
  });
});
