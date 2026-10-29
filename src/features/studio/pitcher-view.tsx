"use client";

/**
 * Pitcher — local pitch & tempo adjustment with two honest modes:
 *  - Coupled (tape-style): single resample by pitch×tempo. High quality; pitch
 *    and tempo move together.
 *  - Duration-preserving: granular OLA time-stretch + resample. Keeps duration;
 *    artifacts possible at extreme settings (disclosed).
 * A/B preview renders the processed audio locally; export runs via the queue.
 */

import { useEffect, useRef, useState } from "react";
import { Music2, Play, Square, Download, RotateCcw, TriangleAlert, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { InlineJob } from "@/components/studio/inline-job";
import { ExportFormatSelect, useExportFormatDefault, type ExportFormatValue } from "@/components/studio/export-format-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { makePitchTask } from "@/lib/studio/tasks";
import { renderPitch } from "@/lib/studio/processing";
import { encodeWav } from "@/lib/studio/wav";
import { getDecodeContext } from "@/lib/studio/decode";
import { formatTime } from "@/lib/studio/format";

export function PitcherView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const enqueue = useJobs((s) => s.enqueue);
  const [trackId, setTrackId] = useState<string | null>(preselected);
  const [semitones, setSemitones] = useState(0);
  const [cents, setCents] = useState(0);
  const [tempo, setTempo] = useState(1);
  const [preserveDuration, setPreserveDuration] = useState(true);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [fmt, setFmt] = useState<ExportFormatValue>(useExportFormatDefault());

  // Local preview state (rendered on demand, not faked).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<"original" | "processed" | null>(null);
  const [rendering, setRendering] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const track = trackId ? getTrackById(trackId) : undefined;

  useEffect(() => {
    if (!trackId && preselected) setTrackId(preselected);
  }, [preselected, trackId]);

  // Full teardown of the preview element.
  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetAll = () => {
    setSemitones(0);
    setCents(0);
    setTempo(1);
    setPreserveDuration(true);
  };

  const dirty = semitones !== 0 || cents !== 0 || tempo !== 1;

  const preview = (which: "original" | "processed") => {
    if (!previewAudioRef.current) previewAudioRef.current = new Audio();
    const el = previewAudioRef.current;
    if (which === "original") {
      if (!track) return;
      if (previewing === "original" && !el.paused) {
        el.pause();
        setPreviewing(null);
        return;
      }
      el.src = track.url;
      void el.play().then(() => setPreviewing("original")).catch(() => setPreviewing(null));
      return;
    }
    // processed
    if (previewing === "processed" && !el.paused) {
      el.pause();
      setPreviewing(null);
      return;
    }
    if (previewUrl) {
      el.src = previewUrl;
      void el.play().then(() => setPreviewing("processed")).catch(() => setPreviewing(null));
    }
  };

  const renderPreview = async () => {
    if (!track || !track.meta) return;
    setRendering(true);
    try {
      const ctx = getDecodeContext();
      const bytes = await track.file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      const rendered = await renderPitch(buffer, {
        semitones,
        cents,
        tempo,
        preserveDuration,
      });
      const blob = await encodeWav(rendered, {
        bitDepth: 16,
        signal: new AbortController().signal,
      });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      toast.success("Preview rendered", {
        description: `${formatTime(rendered.duration)} — play it with the “Processed” button.`,
      });
    } catch (err) {
      toast.error("Preview render failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRendering(false);
    }
  };

  const exportProcessed = () => {
    if (!track) return;
    const job = enqueue(
      "export",
      `Pitch ${semitones >= 0 ? "+" : ""}${semitones}st${cents !== 0 ? ` ${cents >= 0 ? "+" : ""}${cents}c` : ""}${tempo !== 1 ? ` ×${tempo}` : ""} → ${fmt.format.toUpperCase()} — ${track.name}`,
      makePitchTask({ track, semitones, cents, tempo, preserveDuration, format: fmt.format, mp3Bitrate: fmt.mp3Bitrate })
    );
    setJobIds((prev) => [job, ...prev].slice(0, 3));
    toast.info("Added to processing queue");
  };

  if (!track) {
    return (
      <div>
        <PageHeader
          title="Pitcher"
          description="Adjust pitch (semitones + fine cents) and tempo locally. Two real backends are available; the active one depends on your duration setting."
        />
        <EmptyState
          icon={Music2}
          title="Select a track to pitch"
          description="Import audio and choose it here. Original playback is available for A/B comparison."
        />
        <div className="mx-auto mt-4 max-w-xl">
          <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to pitch" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Pitcher"
        description="Pitch and tempo processing runs entirely on this device. Duration-preserving mode uses a granular (OLA) engine; coupled mode is a clean resample."
      />

      <div className="mb-4 max-w-xl">
        <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to pitch" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Processing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Pitch</Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {semitones >= 0 ? "+" : ""}
                  {semitones} st {cents >= 0 ? "+" : ""}
                  {cents} cents
                </span>
              </div>
              <Slider
                aria-label="Semitones"
                value={[semitones]}
                min={-12}
                max={12}
                step={1}
                onValueChange={(v) => setSemitones(v[0] ?? 0)}
              />
              <Slider
                aria-label="Fine cents"
                value={[cents]}
                min={-100}
                max={100}
                step={5}
                onValueChange={(v) => setCents(v[0] ?? 0)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Tempo</Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">×{tempo.toFixed(2)}</span>
              </div>
              <Slider
                aria-label="Tempo multiplier"
                value={[tempo]}
                min={0.5}
                max={2}
                step={0.05}
                onValueChange={(v) => setTempo(v[0] ?? 1)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-xs font-medium">Preserve duration</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {preserveDuration
                    ? "Granular time-stretch keeps the duration constant."
                    : "Coupled mode: pitch and tempo move together (tape-style)."}
                </p>
              </div>
              <Switch checked={preserveDuration} onCheckedChange={setPreserveDuration} aria-label="Preserve duration" />
            </div>

            {!preserveDuration && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <p>
                  Coupled mode changes duration by {(1 / (Math.pow(2, (semitones + cents / 100) / 12) * tempo)).toFixed(2)}×.
                </p>
              </div>
            )}
            {preserveDuration && Math.abs(semitones) > 5 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <p>
                  Shifts beyond ±5 semitones may produce audible granular artifacts. Preview before exporting.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button onClick={() => preview("original")} variant="outline" className="gap-1.5" size="sm">
                {previewing === "original" ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                Original
              </Button>
              <Button
                onClick={() => preview("processed")}
                variant="outline"
                className="gap-1.5"
                size="sm"
                disabled={!previewUrl}
              >
                {previewing === "processed" ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                Processed {previewUrl ? "" : "(render first)"}
              </Button>
              <Button onClick={() => void renderPreview()} disabled={rendering || !dirty} className="gap-1.5" size="sm">
                {rendering && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {rendering ? "Rendering…" : "Render preview"}
              </Button>
              <Button onClick={exportProcessed} disabled={!dirty} className="gap-1.5" size="sm">
                <Download className="h-3.5 w-3.5" aria-hidden /> Export
              </Button>
              <Button onClick={resetAll} variant="ghost" className="gap-1.5" size="sm">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
              </Button>
            </div>
            <div className="border-t border-border pt-4">
              <ExportFormatSelect value={fmt} onChange={setFmt} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Export jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing exported yet. Exports run in the processing queue with real progress.
              </p>
            ) : (
              jobIds.map((id) => <InlineJob key={id} jobId={id} />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
