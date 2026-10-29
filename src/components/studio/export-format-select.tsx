"use client";

/**
 * Shared export-format selector. Reflects a controlled value and reports the
 * chosen format/bitrate back to the parent for per-job override. WAV 16/24 are
 * real (PCM); MP3 is real (lamejs). FLAC is honestly absent here — it stays a
 * desktop-build capability.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/studio/store-settings";
import type { ExportFormat, Mp3Bitrate } from "@/lib/studio/types";

export interface ExportFormatValue {
  format: ExportFormat;
  mp3Bitrate: Mp3Bitrate;
}

export function ExportFormatSelect({
  value,
  onChange,
  label = "Export format",
  className,
}: {
  value: ExportFormatValue;
  onChange: (v: ExportFormatValue) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{label}</Label>
          <Select
            value={value.format}
            onValueChange={(v) => onChange({ format: v as ExportFormat, mp3Bitrate: value.mp3Bitrate })}
          >
            <SelectTrigger className="w-full" aria-label="Export format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wav16">WAV · 16-bit PCM</SelectItem>
              <SelectItem value="wav24">WAV · 24-bit PCM</SelectItem>
              <SelectItem value="mp3">MP3 · {value.mp3Bitrate} kbps</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.format === "mp3" && (
          <div className="space-y-1.5">
            <Label className="text-xs">MP3 bitrate</Label>
            <Select
              value={String(value.mp3Bitrate)}
              onValueChange={(v) => onChange({ format: "mp3", mp3Bitrate: Number(v) as Mp3Bitrate })}
            >
              <SelectTrigger className="w-full" aria-label="MP3 bitrate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="128">128 kbps</SelectItem>
                <SelectItem value="192">192 kbps</SelectItem>
                <SelectItem value="256">256 kbps</SelectItem>
                <SelectItem value="320">320 kbps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {value.format === "mp3"
          ? "MP3 encoded locally with lamejs (no upload)."
          : "Lossless PCM WAV. Compressed encoders arrive with the desktop FFmpeg pipeline."}
      </p>
    </div>
  );
}

/** Convenience hook for a per-view format override initialized from settings. */
export function useExportFormatDefault(): ExportFormatValue {
  const format = useSettings((s) => s.exportFormat);
  const mp3Bitrate = useSettings((s) => s.mp3Bitrate);
  return { format, mp3Bitrate };
}
