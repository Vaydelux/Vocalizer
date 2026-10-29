"use client";

/**
 * Joiner — multi-track ordered join with optional crossfade, sample-rate and
 * channel normalization, per-item preview, and stream validation before export.
 * Input buffers are decoded and validated first; the join itself renders
 * through a real OfflineAudioContext graph.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Combine, ListPlus, Play, Square, GripVertical, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { InlineJob } from "@/components/studio/inline-job";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getTrackById, useTracks } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { makeJoinTask } from "@/lib/studio/tasks";
import { useSettings } from "@/lib/studio/store-settings";
import { ExportFormatSelect, useExportFormatDefault, type ExportFormatValue } from "@/components/studio/export-format-select";
import { formatBytes, formatTime } from "@/lib/studio/format";

interface Item {
  trackId: string;
  gain: number;
}

export function JoinerView() {
  const tracks = useTracks((s) => s.tracks);
  const preselected = useUi((s) => s.preselectedTrackId);
  const enqueue = useJobs((s) => s.enqueue);
  const sampleRatePref = useSettings((s) => s.sampleRate);

  const readyTracks = useMemo(() => tracks.filter((t) => t.status === "ready" && t.meta), [tracks]);
  const [items, setItems] = useState<Item[]>(
    // Views remount on navigation, so mount-time preselection is always fresh.
    preselected && preselected.length > 0 ? [{ trackId: preselected, gain: 1 }] : []
  );
  const [pick, setPick] = useState<string>("");
  const [crossfade, setCrossfade] = useState(0);
  const [channels, setChannels] = useState<"auto" | "1" | "2">("auto");
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [fmt, setFmt] = useState<ExportFormatValue>(useExportFormatDefault());

  // Single shared preview element — never two at once, torn down on unmount.
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      previewRef.current?.pause();
      previewRef.current = null;
    };
  }, []);

  // Apply "open with" preselection at mount time (views remount on navigation).
  const addItem = (id: string) => {
    if (!id) return;
    if (items.some((i) => i.trackId === id)) {
      toast.info("Track already in the join list");
      return;
    }
    setItems((prev) => [...prev, { trackId: id, gain: 1 }]);
    setPick("");
  };

  const preview = (id: string) => {
    const track = getTrackById(id);
    if (!track) return;
    if (!previewRef.current) previewRef.current = new Audio();
    const el = previewRef.current;
    if (previewingId === id && !el.paused) {
      el.pause();
      setPreviewingId(null);
      return;
    }
    el.src = track.url;
    el.onended = () => setPreviewingId(null);
    void el.play().then(() => setPreviewingId(id)).catch(() => setPreviewingId(null));
  };

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const remove = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const totalDuration = useMemo(() => {
    let total = 0;
    for (const item of items) {
      const t = getTrackById(item.trackId);
      if (!t?.meta) return null;
      total += t.meta.duration;
      if (crossfade > 0 && total > 0) total -= crossfade;
    }
    return items.length > 0 ? Math.max(0, total) : 0;
  }, [items, crossfade]);

  const missing = useMemo(
    () => items.filter((i) => !getTrackById(i.trackId) || getTrackById(i.trackId)!.status !== "ready").length,
    [items]
  );

  const run = () => {
    if (items.length < 2) {
      toast.error("Add at least two tracks to join");
      return;
    }
    if (missing > 0) {
      toast.error("Some files are no longer available", {
        description: "Remove the unavailable entries before running the join.",
      });
      return;
    }
    const resolved = items.map((i) => getTrackById(i.trackId)!);
    const job = enqueue(
      "export",
      `Join ${items.length} tracks${crossfade > 0 ? ` · ${crossfade.toFixed(1)}s crossfade` : ""} → ${fmt.format.toUpperCase()}`,
      makeJoinTask({
        tracks: resolved,
        crossfadeSec: crossfade,
        sampleRatePref,
        channels: channels === "auto" ? "auto" : channels === "1" ? 1 : 2,
        format: fmt.format,
        mp3Bitrate: fmt.mp3Bitrate,
      })
    );
    setJobIds((prev) => [job, ...prev].slice(0, 4));
    toast.info("Added to processing queue", { description: "Join job queued — watch progress below or in the queue view." });
  };

  if (readyTracks.length === 0) {
    return (
      <div>
        <PageHeader
          title="Joiner"
          description="Combine multiple audio files in order with optional crossfade and normalization."
        />
        <EmptyState
          icon={Combine}
          title="No audio ready to join"
          description="Import at least two tracks to build a joined output."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Joiner"
        description="Combine audio files in your chosen order. Sample rate and channel differences are normalized with a real resampler — never lossy stream-copy shortcuts."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Join list ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Select value={pick} onValueChange={addItem}>
                <SelectTrigger className="w-full" aria-label="Add a track to the join list">
                  <SelectValue placeholder="Add a track…" />
                </SelectTrigger>
                <SelectContent className="studio-scroll max-h-72 overflow-y-auto">
                  {readyTracks.map((t) => (
                    <SelectItem key={t.id} value={t.id} disabled={items.some((i) => i.trackId === t.id)}>
                      <span className="block max-w-[300px] truncate">{t.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{formatTime(t.meta!.duration)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {items.length === 0 ? (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                <ListPlus className="mr-2 h-4 w-4" aria-hidden /> Add tracks to arrange the join order
              </div>
            ) : (
              <ol className="studio-scroll max-h-80 space-y-2 overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const t = getTrackById(item.trackId);
                  if (!t) return null;
                  return (
                    <li
                      key={item.trackId}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5"
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                      <span className="w-5 shrink-0 text-center text-xs font-mono text-muted-foreground">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.meta ? formatTime(t.meta.duration) : "—"} · {t.meta?.sampleRate ?? "?"} Hz ·{" "}
                          {t.meta?.channels ?? "?"} ch · {formatBytes(t.size)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => preview(item.trackId)}
                        aria-label={previewingId === item.trackId ? "Stop preview" : "Preview this file"}
                      >
                        {previewingId === item.trackId ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                      </Button>
                      <div className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          className="flex h-4 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(idx, 1)}
                          disabled={idx === items.length - 1}
                          className="flex h-4 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(idx)} aria-label="Remove from list">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Output settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Crossfade</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{crossfade.toFixed(1)} s</span>
                </div>
                <Slider
                  aria-label="Crossfade seconds"
                  value={[crossfade]}
                  min={0}
                  max={5}
                  step={0.1}
                  onValueChange={(v) => setCrossfade(v[0] ?? 0)}
                />
                <p className="text-[11px] text-muted-foreground">0 s = butt join. Crossfade is equal-power.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Channels</Label>
                <Select value={channels} onValueChange={(v) => setChannels(v as typeof channels)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Match first track</SelectItem>
                    <SelectItem value="2">Stereo</SelectItem>
                    <SelectItem value="1">Mono</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sample rate</Label>
                <Select value={String(sampleRatePref)} onValueChange={() => { /* changed in Settings */ }}>
                  <SelectTrigger className="w-full" disabled><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Match first track</SelectItem>
                    <SelectItem value="44100">44100 Hz</SelectItem>
                    <SelectItem value="48000">48000 Hz</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Sample rate follows Settings → Export.</p>
              </div>
              <ExportFormatSelect value={fmt} onChange={setFmt} />

              <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5 text-xs">
                <span className="text-muted-foreground">Estimated output</span>
                <span className="font-mono tabular-nums">
                  {totalDuration === null ? "—" : formatTime(totalDuration)}
                </span>
              </div>

              <Button className="w-full gap-1.5" onClick={run} disabled={items.length < 2 || missing > 0}>
                <Combine className="h-4 w-4" aria-hidden /> Join {items.length > 0 ? `${items.length} tracks` : ""}
              </Button>
              {missing > 0 && (
                <Badge variant="outline" className="w-full justify-center border-amber-500/40 text-amber-600 dark:text-amber-400">
                  {missing} item{missing > 1 ? "s" : ""} unavailable — remove them first
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent join jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {jobIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing queued yet.</p>
              ) : (
                jobIds.map((id) => <InlineJob key={id} jobId={id} />)
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
