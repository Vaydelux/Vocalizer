"use client";

/**
 * Key & BPM Finder — genuine offline analysis (spectral-flux autocorrelation
 * for tempo; chroma × Krumhansl–Kessler profiles for key). Results are
 * computed from the imported audio; confidence comes from the algorithm, and
 * manual corrections are clearly labeled.
 */

import { useState } from "react";
import { KeySquare, Copy, Download, Timer, Music2, Info } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { WavePlayer } from "@/components/studio/wave-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { useAnalysis } from "@/lib/studio/store-analysis";
import { makeBpmTask, makeKeyTask } from "@/lib/studio/tasks";
import { downloadText } from "@/lib/studio/download";
import { formatPercent } from "@/lib/studio/format";
import type { BpmResult, KeyResult } from "@/lib/studio/types";

const PITCHES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
/** All 24 keys (12 tonics × major/minor) for manual override. */
const KEY_OPTIONS: string[] = [
  ...PITCHES.map((p) => `${p} major`),
  ...PITCHES.map((p) => `${p} minor`),
];

export function KeyBpmView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const enqueue = useJobs((s) => s.enqueue);
  const [trackId, setTrackId] = useState<string | null>(preselected);
  const [manualText, setManualText] = useState("");
  const track = trackId ? getTrackById(trackId) : undefined;

  const bpm = useAnalysis((s) => (trackId ? s.bpmByTrack[trackId] : undefined));
  const key = useAnalysis((s) => (trackId ? s.keyByTrack[trackId] : undefined));
  const manualKey = useAnalysis((s) => (trackId ? s.manualKeyByTrack[trackId] : undefined));
  const setManualBpm = useAnalysis((s) => s.setManualBpm);
  const setManualKey = useAnalysis((s) => s.setManualKey);

  const applyManual = (value: number | null) => {
    if (!trackId) return;
    setManualBpm(trackId, value);
    setManualText(value !== null ? String(value) : "");
  };

  const runBpm = () => {
    if (!track) return;
    enqueue("analysis", `Tempo analysis — ${track.name}`, makeBpmTask({ track }));
  };
  const runKey = () => {
    if (!track) return;
    enqueue("analysis", `Key analysis — ${track.name}`, makeKeyTask({ track }));
  };

  const copyResults = () => {
    if (!track) return;
    const payload: Record<string, unknown> = { file: track.name };
    if (bpm) {
      payload.bpm = bpm.manualBpm ?? bpm.bpm;
      payload.bpmDetected = bpm.bpm;
      payload.bpmConfidence = bpm.confidence;
      payload.bpmAlternatives = bpm.alternatives;
    }
    if (key) payload.keyDetected = key.label;
    if (manualKey) payload.manualKey = manualKey;
    if (key || manualKey) payload.key = manualKey ?? key?.label;
    void navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .then(() => toast.success("Analysis copied to clipboard"))
      .catch(() => toast.error("Clipboard write failed"));
  };

  const exportResults = () => {
    if (!track) return;
    const payload: Record<string, unknown> = { file: track.name, exportedAt: new Date().toISOString() };
    if (bpm) {
      payload.bpm = bpm.manualBpm ?? bpm.bpm;
      payload.bpmDetected = bpm.bpm;
      payload.bpmConfidence = bpm.confidence;
      payload.bpmAlternatives = bpm.alternatives;
      payload.analysisWindow = bpm.windowNote;
    }
    if (key) payload.keyDetected = key;
    if (manualKey) payload.manualKey = manualKey;
    if (key || manualKey) payload.key = manualKey ?? key?.label;
    downloadText(JSON.stringify(payload, null, 2), `${track.name.replace(/\.[^.]+$/, "")}_analysis.json`);
  };

  if (!track) {
    return (
      <div>
        <PageHeader
          title="Key & BPM Finder"
          description="Offline tempo and musical-key detection computed from the audio itself — onset autocorrelation and chroma profile matching. No random values, no invented confidence."
        />
        <EmptyState
          icon={KeySquare}
          title="Select a track to analyze"
          description="Import audio and choose it here. Analysis runs through the processing queue and stays on this device."
        />
        <div className="mx-auto mt-4 max-w-xl">
          <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to analyze" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Key & BPM Finder"
        description="Tempo via spectral-flux autocorrelation; key via pitch-class profile correlation with Krumhansl–Kessler profiles. Half-time/double-time alternatives are shown when they occur."
      />

      <div className="mb-4 max-w-xl">
        <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to analyze" />
      </div>

      <WavePlayer track={track} height={96} className="mb-4" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={runBpm} className="gap-1.5">
          <Timer className="h-4 w-4" aria-hidden /> Analyze BPM
        </Button>
        <Button onClick={runKey} variant="outline" className="gap-1.5">
          <Music2 className="h-4 w-4" aria-hidden /> Detect key
        </Button>
        {(bpm || key) && (
          <>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={copyResults}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={exportResults}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Export JSON
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="h-4 w-4 text-primary" aria-hidden /> Tempo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!bpm ? (
              <p className="text-sm text-muted-foreground">Not analyzed yet. Run “Analyze BPM”.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-semibold tabular-nums">
                    {bpm.manualBpm ?? (bpm.bpm > 0 ? bpm.bpm : "—")}
                  </span>
                  <span className="text-sm text-muted-foreground">BPM</span>
                  {bpm.manualBpm !== null && <Badge variant="outline" className="text-[10px]">manual</Badge>}
                </div>
                {bpm.manualBpm === null && bpm.bpm > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Estimated confidence: {formatPercent(bpm.confidence)} · window: {bpm.windowNote}
                  </p>
                )}
                {bpm.manualBpm === null && bpm.bpm === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No usable tempo peak was found (silent or noise-only signal). Confidence 0 — no value was invented.
                  </p>
                )}
                {bpm.alternatives.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium">Alternatives</p>
                    <div className="flex flex-wrap gap-1.5">
                      {bpm.alternatives.map((a, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">
                          {a.bpm} BPM <span className="ml-1 text-muted-foreground">({a.note})</span>
                          <button
                            type="button"
                            className="ml-1 text-primary hover:underline"
                            onClick={() => {
                              applyManual(a.bpm);
                              toast.info(`Manual BPM set to ${a.bpm}`);
                            }}
                          >
                            use
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-end gap-2 border-t border-border pt-3">
                  <div className="space-y-1">
                    <Label htmlFor="manual-bpm" className="text-xs">Manual correction</Label>
                    <div className="flex gap-2">
                      <Input
                        id="manual-bpm"
                        className="h-8 w-24 font-mono text-xs"
                        placeholder={bpm.bpm > 0 ? String(bpm.bpm) : "e.g. 120"}
                        inputMode="decimal"
                        value={manualText}
                        onChange={(e) => setManualText(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          const v = parseFloat(manualText);
                          if (!Number.isFinite(v) || v <= 0 || v > 400) {
                            toast.error("Enter a BPM between 1 and 400");
                            return;
                          }
                          applyManual(v);
                          toast.success(`Manual BPM set to ${v}`);
                        }}
                      >
                        Apply
                      </Button>
                      {bpm.manualBpm !== null && (
                        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => applyManual(null)}>
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Music2 className="h-4 w-4 text-primary" aria-hidden /> Musical key
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!key && !manualKey ? (
              <p className="text-sm text-muted-foreground">Not analyzed yet. Run “Detect key”, or pick a manual override below.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-semibold">{manualKey ?? key?.label ?? "—"}</span>
                  {manualKey && <Badge variant="outline" className="text-[10px]">manual</Badge>}
                </div>
                {key && (
                  <p className="text-xs text-muted-foreground">
                    Detected: {key.label} · profile correlation r = {key.correlation.toFixed(3)} (Krumhansl–Kessler).
                    Correlation strength is the algorithm’s own measure — not a probability.
                  </p>
                )}
                {key && key.alternatives.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium">Next candidates</p>
                    <div className="flex flex-wrap gap-1.5">
                      {key.alternatives.map((a) => (
                        <Badge key={a.label} variant="outline" className="text-xs font-normal">
                          {a.label} · r={a.correlation.toFixed(3)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="border-t border-border pt-3">
                  <Label className="text-xs">Manual key override</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Select
                      value={manualKey ?? ""}
                      onValueChange={(v) => {
                        if (!trackId) return;
                        setManualKey(trackId, v);
                        toast.success(`Manual key set to ${v}`);
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label="Manual key">
                        <SelectValue placeholder={key ? `Use detected (${key.label})` : "Select a key"} />
                      </SelectTrigger>
                      <SelectContent className="studio-scroll max-h-72 overflow-y-auto">
                        {KEY_OPTIONS.map((k) => (
                          <SelectItem key={k} value={k}>{k}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {manualKey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 shrink-0 text-xs"
                        onClick={() => {
                          if (trackId) setManualKey(trackId, null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <p>
          Analysis runs on the middle 90 seconds of long tracks (the whole track when shorter) and is
          reported with the exact window used. Results are estimates from deterministic DSP — the same
          file always produces the same result.
        </p>
      </div>
    </div>
  );
}
