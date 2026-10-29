"use client";

/**
 * Recorder — microphone capture with device selection, permission recovery,
 * pause/resume, live input level, playback, and export (real decode → WAV
 * conversion through the processing queue).
 */

import { useMemo, useState } from "react";
import { Mic, Pause, Play, Square, RefreshCw, Download, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { InlineJob } from "@/components/studio/inline-job";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useMicRecorder } from "@/hooks/use-mic-recorder";
import { useJobs } from "@/lib/studio/store-jobs";
import { makeConvertTask } from "@/lib/studio/tasks";
import { downloadResult } from "@/lib/studio/download";
import { formatBytes, formatTime } from "@/lib/studio/format";

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-75"
        style={{ width: `${Math.min(100, level * 100)}%` }}
      />
    </div>
  );
}

export function RecorderView() {
  const rec = useMicRecorder();
  const enqueue = useJobs((s) => s.enqueue);
  const [jobIds, setJobIds] = useState<string[]>([]);

  const recording = rec.state === "recording";
  const busy = recording || rec.state === "paused";
  const ext = useMemo(() => {
    const mime = rec.mime ?? "";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "audio";
  }, [rec.mime]);

  const exportWav = () => {
    if (!rec.result) return;
    const file = new File([rec.result.blob], `${rec.result.name}-original.${ext}`, { type: rec.result.mime });
    const job = enqueue(
      "convert",
      `Convert recording → WAV (${rec.result.name})`,
      makeConvertTask({ file, friendlyName: rec.result.name })
    );
    setJobIds((prev) => [job, ...prev].slice(0, 3));
  };

  const saveOriginal = () => {
    if (!rec.result) return;
    downloadResult(rec.result.url, `${rec.result.name}.${ext}`);
  };

  return (
    <div>
      <PageHeader
        title="Recorder"
        description="Capture from any input device, monitor the input level, then export. The recording is converted to WAV through the real audio decoder."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Capture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Input device</Label>
              <Select
                value={rec.selectedDeviceId ?? undefined}
                onValueChange={(v) => rec.selectDevice(v)}
                disabled={busy || rec.devices.length === 0}
              >
                <SelectTrigger className="w-full" aria-label="Microphone device">
                  <SelectValue
                    placeholder={rec.devices.length === 0 ? "No input device detected" : "Default input device"}
                  />
                </SelectTrigger>
                <SelectContent className="studio-scroll max-h-64 overflow-y-auto">
                  {rec.devices.map((d, i) => (
                    <SelectItem key={d.deviceId || `dev-${i}`} value={d.deviceId}>
                      {d.label || `Input device ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rec.mime && (
                <p className="text-[11px] text-muted-foreground">
                  Container: <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{ext}</Badge>{" "}
                  chosen from what MediaRecorder actually supports in this browser.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Input level</span>
                <span className="font-mono tabular-nums">{formatTime(rec.elapsedSec)}</span>
              </div>
              <LevelMeter level={rec.level} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!busy && (
                <Button onClick={() => void rec.start()} className="gap-1.5">
                  {rec.state === "idle" ? <Mic className="h-4 w-4" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  {rec.state === "idle" ? "Start recording" : "Re-record"}
                </Button>
              )}
              {recording && (
                <Button variant="outline" onClick={rec.pause} className="gap-1.5">
                  <Pause className="h-4 w-4" aria-hidden /> Pause
                </Button>
              )}
              {rec.state === "paused" && (
                <Button variant="outline" onClick={rec.resume} className="gap-1.5">
                  <Play className="h-4 w-4" aria-hidden /> Resume
                </Button>
              )}
              {busy && (
                <Button variant="destructive" onClick={rec.stop} className="gap-1.5">
                  <Square className="h-4 w-4" aria-hidden /> Stop
                </Button>
              )}
              {rec.state === "stopped" && (
                <Button variant="ghost" onClick={rec.reset} className="gap-1.5">
                  <RefreshCw className="h-4 w-4" aria-hidden /> New recording
                </Button>
              )}
            </div>

            {rec.error && (
              <CapabilityBanner tone="warning" title={`[${rec.error.code}]`}>
                {rec.error.message}
              </CapabilityBanner>
            )}
            {rec.permission === "unknown" && !busy && rec.state === "idle" && (
              <p className="text-[11px] text-muted-foreground">
                Press Start to trigger the browser permission prompt. Nothing is transmitted anywhere.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!rec.result ? (
              <p className="text-sm text-muted-foreground">
                {busy ? "Recording…" : "No recording yet."}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{rec.result.name}</span>
                  <span className="font-mono tabular-nums">
                    {formatTime(rec.result.durationSec)} · {formatBytes(rec.result.blob.size)}
                  </span>
                </div>
                <audio controls src={rec.result.url} className="w-full" preload="metadata" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" onClick={exportWav}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export as WAV
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={saveOriginal}>
                    <Save className="h-3.5 w-3.5" aria-hidden /> Save original ({ext})
                  </Button>
                </div>
              </>
            )}
            {jobIds.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {jobIds.map((id) => (
                  <InlineJob key={id} jobId={id} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
