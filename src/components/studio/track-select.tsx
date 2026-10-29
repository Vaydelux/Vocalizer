"use client";

/**
 * Track selector — lists only successfully decoded ("ready") tracks with real
 * metadata in the labels. Empty/error tracks are never offered as usable input.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTracks } from "@/lib/studio/store-tracks";
import { formatBytes, formatTime } from "@/lib/studio/format";
import { cn } from "@/lib/utils";

export function TrackSelect({
  value,
  onChange,
  placeholder = "Select an imported track",
  className,
  ariaLabel,
}: {
  value: string | null;
  onChange: (trackId: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const tracks = useTracks((s) => s.tracks);
  const ready = tracks.filter((t) => t.status === "ready" && t.meta);

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onChange(v)}
      disabled={ready.length === 0}
    >
      <SelectTrigger className={cn("w-full", className)} aria-label={ariaLabel ?? "Audio track"}>
        <SelectValue placeholder={ready.length === 0 ? "No ready tracks — import audio first" : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72 overflow-y-auto">
        {ready.map((t) => (
          <SelectItem key={t.id} value={t.id} className="gap-2">
            <span className="block max-w-[320px] truncate sm:max-w-[420px]">{t.name}</span>
            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
              {formatTime(t.meta!.duration)} · {t.meta!.sampleRate ?? "?"} Hz ·{" "}
              {t.meta!.channels ?? "?"} ch · {formatBytes(t.size)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
