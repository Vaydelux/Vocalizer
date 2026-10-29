"use client";

/**
 * Audio dropzone — drag-and-drop + native picker. Files are validated by the
 * decoder during import (see store-tracks), never by extension alone.
 */

import { useCallback, useRef, useState } from "react";
import { FileAudio, CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTracks } from "@/lib/studio/store-tracks";
import { Button } from "@/components/ui/button";

export function Dropzone({ compact = false }: { compact?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = useTracks((s) => s.addFiles);
  const depth = useRef(0);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) addFiles(files);
    },
    [addFiles]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Import audio files"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "group flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/40 text-center transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "border-primary bg-primary/5",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-primary/10 transition-transform group-hover:scale-105",
          compact ? "h-9 w-9" : "h-12 w-12"
        )}
      >
        {dragging ? (
          <FileAudio className={cn("text-primary", compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
        ) : (
          <CloudUpload className={cn("text-primary", compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {dragging ? "Drop to import" : "Import audio files"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Drag &amp; drop or click to browse · MP3, WAV, FLAC, M4A, OGG and more
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm,.aiff,.aif,.wma"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) addFiles(files);
          e.target.value = "";
        }}
      />
      {!compact && (
        <Button variant="ghost" size="sm" tabIndex={-1} className="pointer-events-none text-xs text-muted-foreground">
          Files stay on this device — nothing is uploaded
        </Button>
      )}
    </div>
  );
}
