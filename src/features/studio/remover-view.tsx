"use client";

/**
 * Vocalizer Remover: truthful, local-only two-stem CPU preview.
 * The registry does not imply that model weights are installed. Keep outputs
 * tied to their source track, expose real queued/running/cancelled states, and
 * refuse concurrent inference jobs against the single-worker runtime.
 */

import { useCallback, useEffect, useState } from "react";
import { FileAudio2, FolderOpen, LoaderCircle, MicOff, RefreshCcw, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { InlineJob } from "@/components/studio/inline-job";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTracks } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useSettings } from "@/lib/studio/store-settings";
import { makeInferenceTask } from "@/lib/studio/inference-task";
import { useJobs } from "@/lib/studio/store-jobs";
import { formatTime } from "@/lib/studio/format";
import { native, isNative } from "@/lib/studio/native";

const MODEL_NAME = "UVR-MDX-NET-Inst_HQ_5.onnx";
const ACTIVE_STATES = new Set(["queued", "preparing", "running", "cancelling"]);

export function RemoverView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const [trackId, setTrackId] = useState<string | null>(preselected);
  const tracks = useTracks((s) => s.tracks);
  const track = tracks.find((t) => t.id === trackId && t.status === "ready" && t.meta);

  const exportFormat = useSettings((s) => s.exportFormat);
  const mp3Bitrate = useSettings((s) => s.mp3Bitrate);
  const jobs = useJobs((s) => s.jobs);
  const enqueue = useJobs((s) => s.enqueue);

  const activeInference = jobs.find((j) => j.type === "inference" && ACTIVE_STATES.has(j.state));
  const completedStems = [...jobs].reverse().find((j) =>
    j.type === "inference" &&
    j.state === "completed" &&
    j.result?.sourceTrackId === trackId &&
    j.result.stemFiles?.length
  );
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const currentJob = lastJobId ? jobs.find((j) => j.id === lastJobId) : undefined;

  const [localModelPath, setLocalModelPath] = useState<string | null>(null);
  const [inferenceProfile, setInferenceProfile] = useState<"low-memory" | "balanced" | "thorough">("balanced");
  const [localModelError, setLocalModelError] = useState<string | null>(null);
  const [workerDetected, setWorkerDetected] = useState(false);
  const [checkingRuntime, setCheckingRuntime] = useState(true);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    if (preselected) setTrackId(preselected);
  }, [preselected]);

  const refreshRuntime = useCallback(async () => {
    const api = native();
    if (!api) {
      setWorkerDetected(false);
      setCheckingRuntime(false);
      return;
    }
    setCheckingRuntime(true);
    try {
      const status = await api.inferenceStatus();
      setWorkerDetected(status.workerAvailable);
    } catch {
      setWorkerDetected(false);
    } finally {
      setCheckingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void refreshRuntime();
    // A transient worker failure may recover when the user revisits the app.
    const onFocus = () => { void refreshRuntime(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshRuntime]);

  async function chooseModel() {
    const api = native();
    if (!api) return;
    setLocalModelError(null);
    try {
      const files = await api.openFiles({
        multiple: false,
        filters: [{ name: "MDX-Net ONNX checkpoint", extensions: ["onnx"] }],
      });
      if (!files?.length) return;
      const selected = files[0];
      if (selected.split(/[\\/]/).pop() !== MODEL_NAME) {
        setLocalModelPath(null);
        setLocalModelError(`Select ${MODEL_NAME}. Other checkpoints have not been verified.`);
        return;
      }
      // Validation happens in the privileged main process and Python worker
      // before model loading; selecting a path does not confirm its checksum.
      setLocalModelPath(selected);
    } catch (error) {
      setLocalModelError(error instanceof Error ? error.message : "The file picker failed.");
    }
  }

  function startSeparation() {
    if (!track || !workerDetected || !localModelPath || activeInference) return;
    setRevealError(null);
    const id = enqueue(
      "inference",
      `Separate ${track.name} (vocals and instrumental)`,
      makeInferenceTask({
        track,
        requestedStems: ["Vocals", "Instrumental"],
        preferredModelId: null,
        device: "cpu",
        outputFormat: exportFormat,
        mp3Bitrate,
        localModelPath,
        profile: inferenceProfile,
      })
    );
    setLastJobId(id);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vocal Remover"
        description="Separate a local audio track into vocals and instrumental using the verified CPU inference path. No cloud uploads or simulated audio."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refreshRuntime()}
            disabled={checkingRuntime || !isNative()}
            aria-label="Refresh inference worker status"
          >
            <RefreshCcw className={checkingRuntime ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
            Check runtime
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 ${workerDetected ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground"}`}>
          {checkingRuntime ? "Checking inference files…" : workerDetected ? "CPU worker detected" : "CPU worker unavailable"}
        </span>
        <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">Two-stem · CPU-only</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">No default model bundled</span>
      </div>

      <CapabilityBanner tone={workerDetected ? "info" : "unavailable"}
        title={workerDetected ? "Ready for local checkpoint verification" : "Inference requires the packaged Windows worker"}>
        This debug build does not contain model weights. Select your own lawful copy of
        {" "}<strong>{MODEL_NAME}</strong>. The checksum is verified when processing starts.
        Worker detection only confirms that runtime files exist; successful inference still needs a real test.
      </CapabilityBanner>

      {!track ? (
        <div className="space-y-3">
          <EmptyState
            icon={MicOff}
            title="Choose audio to separate"
            description="Import an audio track into the library, then select it here. Only successfully decoded tracks are available."
          />
          <div className="mx-auto max-w-xl">
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to separate" />
          </div>
        </div>
      ) : (
        <>
          <div className="max-w-2xl space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Source track</label>
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to separate" />
            <p className="text-xs text-muted-foreground">
              {formatTime(track.meta!.duration)} · {track.meta!.sampleRate ?? "?"} Hz · {track.meta!.channels ?? "?"} channels
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" aria-hidden /> Local AI checkpoint</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Select an existing MDX-Net model file. No downloads or automatic model installations occur during separation.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center"
                  disabled={!isNative() || Boolean(activeInference)}
                  onClick={() => void chooseModel()}
                >
                  <FolderOpen className="h-4 w-4" aria-hidden />
                  {localModelPath ? "Change model file" : "Choose local model file"}
                </Button>
                {localModelPath ? (
                  <div className="min-w-0 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-xs font-medium">{MODEL_NAME}</p>
                    <p className="mt-1 break-all text-[11px] text-muted-foreground" title={localModelPath}>
                      {localModelPath}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Integrity verification runs before inference; selection is not approval.</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground">No checkpoint selected.</p>}
                {localModelError ? <p role="alert" className="text-xs text-destructive">{localModelError}</p> : null}
                <div className="space-y-2">
                  <Label htmlFor="ai-processing-profile">Processing profile</Label>
                  <Select value={inferenceProfile} onValueChange={(v) => setInferenceProfile(v as typeof inferenceProfile)} disabled={Boolean(activeInference)}>
                    <SelectTrigger id="ai-processing-profile"><SelectValue placeholder="Select a profile" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low-memory">Lower memory · 128 segments</SelectItem>
                      <SelectItem value="balanced">Balanced · 256 segments</SelectItem>
                      <SelectItem value="thorough">Thorough · increased overlap</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Thorough may take longer and use more resources. It is not guaranteed to sound better; compare results with the same source audio.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Output stems</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {(["Vocals", "Instrumental"] as const).map((stem) => {
                    const result = completedStems?.result?.stemFiles?.find((s) => s.stem === stem);
                    return (
                      <div key={stem} className="flex min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-5 text-center">
                        <FileAudio2 className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-xs font-medium">{stem}</p>
                        {result && completedStems ? (
                          <>
                            <p title={result.path} className="w-full truncate text-[11px] text-muted-foreground">
                              {result.path.split(/[\\/]/).pop()}
                            </p>
                            <audio
                              controls
                              preload="none"
                              className="w-full min-w-0"
                              aria-label={`Preview ${stem} stem`}
                              src={`las://renderer/__stem-audio/${encodeURIComponent(completedStems.id)}/${stem}`}
                              onError={() => setRevealError(`Cannot play the ${stem} stem. Check whether the file still exists and use Show in folder.`)}
                            >
                              Your audio player does not support this format.
                            </audio>
                            <Button type="button" variant="outline" size="sm" className="w-full"
                              onClick={async () => {
                                setRevealError(null);
                                try {
                                  await native()?.revealInferenceStem({ jobId: completedStems.id, stem });
                                } catch (error) {
                                  setRevealError(error instanceof Error ? error.message : "Could not open the stem folder.");
                                }
                              }}>
                              Show in folder
                            </Button>
                          </>
                        ) : <p className="text-[11px] text-muted-foreground">No completed stem</p>}
                      </div>
                    );
                  })}
                </div>
                {completedStems?.result?.modelUsed ? (
                  <p className="text-xs text-muted-foreground">
                    Verified job: {completedStems.result.modelUsed} · {completedStems.result.deviceUsed}
                  </p>
                ) : null}
                {revealError ? <p role="alert" className="text-xs text-destructive">{revealError}</p> : null}
                <Button type="button" className="w-full" onClick={startSeparation}
                  disabled={!workerDetected || !localModelPath || Boolean(activeInference) || checkingRuntime}>
                  {activeInference ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <FileAudio2 className="h-4 w-4" aria-hidden />}
                  {activeInference ? "An AI job is already processing" : "Start separation"}
                </Button>
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  Select the output folder when prompted. Each successful stem is written directly to that folder; no installer is required.
                </p>
              </CardContent>
            </Card>
          </div>

          {activeInference && activeInference.id !== lastJobId ? (
            <p role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              Another separation is active. Wait for completion or cancel it in Processing Queue.
            </p>
          ) : null}
          {currentJob ? (
            <section aria-label="Current separation job" className="space-y-2">
              <h2 className="text-sm font-semibold">Processing status</h2>
              <InlineJob jobId={currentJob.id} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
