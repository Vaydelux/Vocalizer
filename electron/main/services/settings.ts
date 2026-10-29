/**
 * Persistent settings store for the desktop runtime. A JSON file in
 * `userData/settings.json` with corruption recovery: if the file is invalid,
 * it falls back to defaults and rewrites. Schema migration is forward-fill.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { nativeSettingsSchema, type NativeSettings } from "../../shared/ipc";

const DEFAULTS: NativeSettings = {
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

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

let cache: NativeSettings | null = null;

export function getSettings(): NativeSettings {
  if (cache) return cache;
  const file = settingsFile();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = nativeSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      cache = { ...DEFAULTS, ...parsed.data };
      return cache;
    }
  } catch {
    /* missing or corrupt — fall through to defaults */
  }
  cache = { ...DEFAULTS };
  persist(cache);
  return cache;
}

export function setSettings(patch: Partial<NativeSettings>): NativeSettings {
  const next = { ...getSettings(), ...patch };
  const parsed = nativeSettingsSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`Invalid settings patch: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  }
  cache = parsed.data;
  persist(cache);
  return cache;
}

function persist(settings: NativeSettings): void {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
  } catch {
    /* permission errors are non-fatal; settings stay in-memory for the session */
  }
}
