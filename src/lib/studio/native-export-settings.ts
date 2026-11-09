/**
 * Resolve a desktop export at job submission time.
 *
 * Per-job format selections take priority over persisted Studio Settings.
 * The resolved MP3 rate is passed to the validated IPC operation so the
 * native FFmpeg path never silently substitutes 192 kbps for a user choice.
 */
import type { ExportFormat, Mp3Bitrate, StudioSettings } from "./types";

export interface NativeExportOverride {
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export interface NativeExportSelection {
  format: ExportFormat;
  mp3Bitrate: Mp3Bitrate;
}

export function resolveNativeExportSettings(
  override: NativeExportOverride | undefined,
  defaults: Pick<StudioSettings, "exportFormat" | "mp3Bitrate">,
): NativeExportSelection {
  return {
    format: override?.format ?? defaults.exportFormat,
    mp3Bitrate: override?.mp3Bitrate ?? defaults.mp3Bitrate,
  };
}
