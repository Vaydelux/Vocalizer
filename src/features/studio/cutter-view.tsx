"use client";

/**
 * Cutter — waveform region selection, precise times, preview/loop, trim & split
 * exports through the processing queue, undo/redo of edit instructions.
 * Non-destructive: the source file is never modified; exports are new files.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Redo2, Scissors, SquareSplitHorizontal, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { WavePlayer, type RegionRange, type WavePlayerHandle } from "@/components/studio/wave-player";
import { InlineJob } from "@/components/studio/inline-job";
import { ExportFormatSelect, useExportFormatDefault, type ExportFormatValue } from "@/components/studio/export-format-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTracks, getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { makeTrimTask } from "@/lib/studio/tasks";
import { formatTimeMs } from "@/lib/studio/format";

export function CutterView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const jobsEnqueue = useJobs((s) => s.enqueue);
  const tracks = useTracks((s) => s.tracks);
  const readyTracks = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);

  const [trackId, setTrackId] = useState<string | null>(preselected);
  const track = trackId ? getTrackById(trackId) : undefined;
  const playerRef = useRef<WavePlayerHandle>(null);

  const [region, setRegion] = useState<RegionRange | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [fmt, setFmt] = useState<ExportFormatValue>(useExportFormatDefault());

  // Undo/redo of region edit instructions.
  const historyRef = useRef<{ stack: (RegionRange | null)[]; ptr: number }>({
    stack: [null],
    ptr: 0,
  });
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false });

  const pushHistory = useCallback((range: RegionRange | null) => {
    const h = historyRef.current;
    h.stack = h.stack.slice(0, h.ptr + 1);
    h.stack.push(range);
    h.ptr += 1;
    setHistInfo({ canUndo: h.ptr > 0, canRedo: false });
  }, []);

  const applyHistory = useCallback((ptr: number) => {
    const h = historyRef.current;
    const range = h.stack[ptr];
    playerRef.current?.setRegion(range);
    setRegion(range);
    setStartText(range ? range.start.toFixed(3) : "");
    setEndText(range ? range.end.toFixed(3) : "");
    h.ptr = ptr;
    setHistInfo({ canUndo: ptr > 0, canRedo: ptr < h.stack.length - 1 });
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.ptr > 0) applyHistory(h.ptr - 1);
  }, [applyHistory]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.ptr < h.stack.length - 1) applyHistory(h.ptr + 1);
  }, [applyHistory]);

  const onRegionChange = useCallback(
    (range: RegionRange | null) => {
      setRegion(range);
      setStartText(range ? range.start.toFixed(3) : "");
      setEndText(range ? range.end.toFixed(3) : "");
      const h = historyRef.current;
      const current = h.stack[h.ptr];
      const changed =
        (current === null) !== (range === null) ||
        (current !== null && range !== null && (Math.abs(current.start - range.start) > 0.001 || Math.abs(current.end - range.end) > 0.001));
      if (changed) pushHistory(range);
    },
    [pushHistory]
  );

  const clampAndCommit = useCallback(
    (start: number, end: number) => {
      if (!track?.meta) return;
      const dur = track.meta.duration;
      const s = Math.max(0, Math.min(start, dur));
      const e = Math.max(0, Math.min(end, dur));
      if (e - s < 0.01) {
        toast.error("Selection too small", { description: "The selection must be at least 10 ms long." });
        return;
      }
      playerRef.current?.setRegion({ start: s, end: e });
    },
    [track]
  );

  const commitStartText = useCallback(() => {
    const v = parseFloat(startText);
    if (!Number.isFinite(v) || !region) {
      setStartText(region ? region.start.toFixed(3) : "");
      return;
    }
    clampAndCommit(v, region.end);
  }, [startText, region, clampAndCommit]);

  const commitEndText = useCallback(() => {
    const v = parseFloat(endText);
    if (!Number.isFinite(v) || !region) {
      setEndText(region ? region.end.toFixed(3) : "");
      return;
    }
    clampAndCommit(region.start, v);
  }, [endText, region, clampAndCommit]);

  const enqueueTrim = useCallback(
    (label: string, start: number, end: number) => {
      if (!track) return;
      jobsEnqueue(
        "export",
        label,
        makeTrimTask({ track, startSec: start, endSec: end, format: fmt.format, mp3Bitrate: fmt.mp3Bitrate })
      );
      toast.info("Added to processing queue", { description: label });
    },
    [track, jobsEnqueue, fmt]
  );

  const exportSelection = useCallback(() => {
    if (!track || !region) return;
    enqueueTrim(`Cut ${region.start.toFixed(2)}s–${region.end.toFixed(2)}s → export`, region.start, region.end);
  }, [track, region, enqueueTrim]);

  const splitAtMidpoint = useCallback(() => {
    if (!track || !region) return;
    const mid = (region.start + region.end) / 2;
    enqueueTrim(`Split A: ${region.start.toFixed(2)}s–${mid.toFixed(2)}s`, region.start, mid);
    enqueueTrim(`Split B: ${mid.toFixed(2)}s–${region.end.toFixed(2)}s`, mid, region.end);
  }, [track, region, enqueueTrim]);

  if (readyTracks.length === 0) {
    return (
      <div>
        <PageHeader
          title="Cutter"
          description="Select a region on the waveform and export it as a new file. The source track is never modified."
        />
        <EmptyState
          icon={Scissors}
          title="No audio ready to cut"
          description="Import a track first — the cutter needs a decoded file to render a waveform."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Cutter"
        description="Drag on the waveform to select a region, refine the times, preview, then export. Keyboard: I/O set selection edges at the playhead, L loops the selection."
      />

      <div className="mb-4 max-w-xl">
        <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to cut" />
      </div>

      {track ? (
        <div className="space-y-4">
          <WavePlayer
            ref={playerRef}
            track={track}
            height={144}
            withRegion
            onRegionChange={onRegionChange}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Selection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cut-start" className="text-xs">Start (mm:ss.mmm)</Label>
                    <Input
                      id="cut-start"
                      className="font-mono text-xs"
                      placeholder="0:00.000"
                      value={startText}
                      onChange={(e) => setStartText(e.target.value)}
                      onBlur={commitStartText}
                      onKeyDown={(e) => e.key === "Enter" && commitStartText()}
                      disabled={!region}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cut-end" className="text-xs">End (mm:ss.mmm)</Label>
                    <Input
                      id="cut-end"
                      className="font-mono text-xs"
                      placeholder="0:00.000"
                      value={endText}
                      onChange={(e) => setEndText(e.target.value)}
                      onBlur={commitEndText}
                      onKeyDown={(e) => e.key === "Enter" && commitEndText()}
                      disabled={!region}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {region
                    ? `Selected ${(region.end - region.start).toFixed(3)} s — ${formatTimeMs(region.start)} → ${formatTimeMs(region.end)}`
                    : "No selection yet. Drag on the waveform or use I/O keys."}
                </p>
                <ExportFormatSelect value={fmt} onChange={setFmt} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={exportSelection} disabled={!region} className="gap-1.5">
                    <Scissors className="h-3.5 w-3.5" aria-hidden /> Export selection
                  </Button>
                  <Button size="sm" variant="outline" onClick={splitAtMidpoint} disabled={!region} className="gap-1.5">
                    <SquareSplitHorizontal className="h-3.5 w-3.5" aria-hidden /> Split at midpoint
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={!region}
                    onClick={() => {
                      playerRef.current?.setRegion(null);
                      setRegion(null);
                      setStartText("");
                      setEndText("");
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear
                  </Button>
                </div>
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={undo} disabled={!histInfo.canUndo}>
                    <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={redo} disabled={!histInfo.canRedo}>
                    <Redo2 className="h-3.5 w-3.5" aria-hidden /> Redo
                  </Button>
                  <span className="text-[11px] text-muted-foreground">Selection edit history</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Export queue (this session)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <JobListFor label="Cut" />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState icon={Scissors} title="Select a track" description="Choose a track above to load its waveform." />
      )}
    </div>
  );
}

function JobListFor({ label }: { label: string }) {
  const jobs = useJobs((s) => s.jobs);
  const relevant = jobs.filter((j) => j.label.startsWith(label)).slice(-6).reverse();
  if (relevant.length === 0) {
    return <p className="text-xs text-muted-foreground">No {label.toLowerCase()} exports queued yet.</p>;
  }
  return (
    <>
      {relevant.map((j) => (
        <InlineJob key={j.id} jobId={j.id} />
      ))}
    </>
  );
}
