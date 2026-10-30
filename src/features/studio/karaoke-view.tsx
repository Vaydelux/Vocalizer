"use client";

/**
 * Karaoke workspace — practical first version:
 *  - Load an instrumental (from the library), play/pause/seek with waveform.
 *  - Import synchronized LRC lyrics; active line highlighting with adjustable
 *    timing offset; parse issues are reported, never silently dropped.
 *  - Optional microphone recording of the performance, export of the raw take,
 *    and a real mixdown with the instrumental through the queue.
 * Honest limits (no auto-transcription, no auto-sync, no real-time effects)
 * are stated in the UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Mic, MicVocal, Pause, Play, Square, Download, Save, LoaderCircle, Info, CircleX } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { WavePlayer } from "@/components/studio/wave-player";
import { InlineJob } from "@/components/studio/inline-job";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { useMicRecorder } from "@/hooks/use-mic-recorder";
import { parseLrc, activeLrcIndex, type LrcLine } from "@/lib/studio/lrc";
import { makeMixTask } from "@/lib/studio/tasks";
import { ExportFormatSelect, useExportFormatDefault, type ExportFormatValue } from "@/components/studio/export-format-select";
import { downloadResult } from "@/lib/studio/download";
import { formatTime } from "@/lib/studio/format";

export function KaraokeView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const enqueue = useJobs((s) => s.enqueue);

  const [trackId, setTrackId] = useState<string | null>(preselected);
  const track = trackId ? getTrackById(trackId) : undefined;

  const [lines, setLines] = useState<LrcLine[]>([]);
  const [lrcName, setLrcName] = useState<string | null>(null);
  const [lrcIssues, setLrcIssues] = useState<string[]>([]);
  const [offsetMs, setOffsetMs] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [jobIds, setJobIds] = useState<string[]>([]);

  const rec = useMicRecorder();
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const performanceStartRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const [fmt, setFmt] = useState<ExportFormatValue>(useExportFormatDefault());

  const onTime = useCallback((t: number) => {
    playbackTimeRef.current = t;
    setCurrentTime(t);
  }, []);

  const importLrc = async (file: File) => {
    const text = await file.text();
    const parsed = parseLrc(text);
    setLines(parsed.lines);
    setLrcName(file.name);
    setLrcIssues(parsed.issues);
    if (parsed.offsetSec !== 0) {
      setOffsetMs((prev) => prev + parsed.offsetSec * 1000);
    }
    if (parsed.lines.length > 0) {
      toast.success(`Loaded ${parsed.lines.length} lyric lines`, {
        description: parsed.issues.length > 0 ? `${parsed.issues.length} issue(s) reported below.` : undefined,
      });
    } else {
      toast.error("No timestamped lines found", { description: "This does not look like an LRC file." });
    }
  };

  // Adjusted position for lyric sync.
  const tAdjusted = currentTime + offsetMs / 1000;
  const activeIdx = lines.length > 0 ? activeLrcIndex(lines, tAdjusted) : -1;

  // Keep the active line visible.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-line-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  const startPerformance = async () => {
    const started = await rec.start();
    // A permission denial or device failure does not start recording.
    // Only capture a timeline offset after MediaRecorder has actually started.
    if (started) performanceStartRef.current = playbackTimeRef.current;
  };

  const exportTake = () => {
    if (!rec.result) return;
    const ext = rec.result.mime.includes("mp4") ? "m4a" : rec.result.mime.includes("ogg") ? "ogg" : "webm";
    downloadResult(rec.result.url, `${rec.result.name}.${ext}`);
  };

  const exportMix = () => {
    if (!track || !rec.result) return;
    if (rec.result.blob.size > 64 * 1024 * 1024) {
      toast.error("This recording is too large for a native mix.", {
        description: "Export the original take, then re-import and convert it. The in-memory transfer is limited to 64 MiB.",
      });
      return;
    }
    const file = new File([rec.result.blob], rec.result.name, { type: rec.result.mime });
    const job = enqueue(
      "export",
      `Mix performance with ${track.name} → ${fmt.format.toUpperCase()}`,
      makeMixTask({
        instrumental: track,
        micFile: file,
        micStartSec: performanceStartRef.current,
        micGain: 1,
        instrumentalGain: 1,
        format: fmt.format,
        mp3Bitrate: fmt.mp3Bitrate,
      })
    );
    setJobIds((prev) => [job, ...prev].slice(0, 3));
    toast.info("Mixdown queued", { description: "Equal-gain summing of the take with the instrumental." });
  };


  if (!track) {
    return (
      <div>
        <PageHeader
          title="Karaoke"
          description="Load an instrumental, import synchronized LRC lyrics, and record your performance. Everything stays local."
        />
        <EmptyState
          icon={MicVocal}
          title="Select an instrumental"
          description="Choose the instrumental track you want to sing over. Vocal removal lives in the Remover (unavailable until an AI model is installed)."
        />
        <div className="mx-auto mt-4 max-w-xl">
          <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Instrumental track" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Karaoke"
        description="Instrumental playback, LRC-lyric sync with offset control, and performance recording with a real mixdown export."
      />

      <div className="mb-4 max-w-xl">
        <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Instrumental track" />
      </div>

      <WavePlayer track={track} height={112} onTimeChange={onTime} className="mb-4" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Lyrics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Lyrics (LRC)</span>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-3.5 w-3.5" aria-hidden /> Import .lrc
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".lrc,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importLrc(f);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3">
              <Label className="shrink-0 text-xs">Timing offset</Label>
              <Slider
                aria-label="Lyric timing offset in milliseconds"
                value={[offsetMs]}
                min={-5000}
                max={5000}
                step={50}
                onValueChange={(v) => setOffsetMs(v[0] ?? 0)}
                className="flex-1"
              />
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {offsetMs >= 0 ? "+" : ""}
                {offsetMs} ms
              </span>
            </div>

            {lrcName ? (
              <p className="text-xs text-muted-foreground">
                {lrcName} · {lines.length} lines
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                No lyrics loaded. LRC files with [mm:ss.xx] timestamps and an optional [offset:±ms] tag are supported.
              </p>
            )}

            {lrcIssues.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <CircleX className="h-3.5 w-3.5" aria-hidden /> {lrcIssues.length} parser issue(s):
                </p>
                <ul className="studio-scroll max-h-20 list-disc overflow-y-auto pl-4">
                  {lrcIssues.slice(0, 8).map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div ref={listRef} className="studio-scroll max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {lines.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Import an LRC file to see synchronized lyrics.</p>
              ) : (
                lines.map((line, idx) => (
                  <p
                    key={idx}
                    data-line-idx={idx}
                    className={
                      idx === activeIdx
                        ? "rounded-md bg-primary/15 px-2 py-1 text-sm font-medium text-foreground"
                        : idx < activeIdx
                          ? "px-2 py-1 text-sm text-muted-foreground/60"
                          : "px-2 py-1 text-sm text-muted-foreground"
                    }
                  >
                    <span className="mr-2 font-mono text-[10px] text-muted-foreground/70">{formatTime(line.time)}</span>
                    {line.text || "♪"}
                  </p>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performance recording</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {rec.state !== "recording" && rec.state !== "paused" ? (
                <Button className="gap-1.5" onClick={() => void startPerformance()}>
                  <Mic className="h-4 w-4" aria-hidden /> Record performance
                </Button>
              ) : (
                <>
                  <Button
                    variant="destructive"
                    className="gap-1.5"
                    onClick={() => rec.stop()}
                  >
                    <Square className="h-4 w-4" aria-hidden /> Stop take
                  </Button>
                  {rec.state === "recording" ? (
                    <Button variant="outline" className="gap-1.5" onClick={rec.pause}>
                      <Pause className="h-4 w-4" aria-hidden /> Pause
                    </Button>
                  ) : (
                    <Button variant="outline" className="gap-1.5" onClick={rec.resume}>
                      <Play className="h-4 w-4" aria-hidden /> Resume
                    </Button>
                  )}
                  <Badge variant="outline" className="gap-1 font-mono tabular-nums">
                    <LoaderCircle className="h-3 w-3 animate-spin text-destructive" aria-hidden />
                    {formatTime(rec.elapsedSec)}
                  </Badge>
                </>
              )}
            </div>

            {/* Simple level meter */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: `${Math.min(100, rec.level * 100)}%` }} />
            </div>

            {rec.error && (
              <p className="text-xs text-destructive">
                [{rec.error.code}] {rec.error.message}
              </p>
            )}

            {rec.result && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{rec.result.name}</span>
                  <span className="font-mono">{formatTime(rec.result.durationSec)}</span>
                </div>
                <audio controls src={rec.result.url} preload="metadata" className="w-full" />
                <ExportFormatSelect value={fmt} onChange={setFmt} label="Mix export format" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={exportTake}>
                    <Save className="h-3.5 w-3.5" aria-hidden /> Save take
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={exportMix}>
                    <Download className="h-3.5 w-3.5" aria-hidden /> Mix with instrumental
                  </Button>
                </div>
              </div>
            )}

            {jobIds.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {jobIds.map((id) => (
                  <InlineJob key={id} jobId={id} />
                ))}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                Version 1 scope: manual LRC import (no automatic transcription or sync), dry performance
                capture, and a basic equal-gain mixdown. No real-time vocal effects. Vocal-removed
                instrumentals become available through the Remover once AI processing ships.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
