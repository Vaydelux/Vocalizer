"use client";

/**
 * Remover — AI-ready UI for vocal/instrumental separation.
 * Until a compatible engine and model exist, separation is honestly unavailable.
 * No fake stems, no invented results, ever.
 */

import { useEffect, useState } from "react";
import { MicOff, ShieldAlert, FileAudio2 } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useModels } from "@/lib/studio/store-models";
import { useSettings } from "@/lib/studio/store-settings";
import { formatTime } from "@/lib/studio/format";

export function RemoverView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const [trackId, setTrackId] = useState<string | null>(preselected);
  const track = trackId ? getTrackById(trackId) : undefined;

  const builtin = useModels((s) => s.builtin);
  const userModels = useModels((s) => s.userModels);
  const resolveFor = useModels((s) => s.resolveFor);
  const preferredModelId = useSettings((s) => s.preferredModelId);
  const updateSettings = useSettings((s) => s.update);

  // Resolve the real availability of the selected model for vocal removal.
  // Always unavailable in this build — but the reason is derived from the
  // fallback resolver, not a static string.
  const [resolutionReason, setResolutionReason] = useState<string>(
    "Select a model when one becomes available in the Model Manager."
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await resolveFor({
        operation: "vocal-removal",
        requiredStems: ["Vocals", "Instrumental"],
        preferredModelId: preferredModelId,
        device: null,
      });
      if (!cancelled) setResolutionReason("reason" in r ? r.reason : "Resolved.");
    })();
    return () => { cancelled = true; };
  }, [preferredModelId, resolveFor, userModels.length]);

  const modelOptions = [
    { id: builtin.id, name: builtin.name },
    ...userModels.map((m) => ({ id: m.manifest.modelId, name: m.manifest.displayName })),
  ];
  const selectedModel = preferredModelId ?? null;

  return (
    <div>
      <PageHeader
        title="Remover"
        description="Vocal and instrumental separation workspace. The interface and pipeline contracts are in place; inference activates when a compatible model and runtime are installed."
      />

      {track ? (
        <div className="space-y-4">
          <div className="max-w-xl">
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to process" />
            {track.meta && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatTime(track.meta.duration)} · {track.meta.sampleRate ?? "?"} Hz · {track.meta.channels ?? "?"} ch
              </p>
            )}
          </div>

          <CapabilityBanner tone="unavailable" title="Audio separation is not available yet. Install a compatible model when AI processing support is enabled.">
            The reserved built-in model slot (“{builtin.name}”) is not installed in this phase, and no
            bundled inference runtime exists in the current build. These controls stay inactive rather
            than simulate output.
          </CapabilityBanner>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Model</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={selectedModel ?? ""}
                  onValueChange={(v) => updateSettings({ preferredModelId: v })}
                  disabled={modelOptions.length === 0}
                >
                  <SelectTrigger className="w-full" aria-label="Separation model">
                    <SelectValue placeholder="No models registered" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {selectedModel ? resolutionReason : "Select a model when one becomes available in the Model Manager."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Result slots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {["Vocals", "Instrumental"].map((slot) => (
                    <div
                      key={slot}
                      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-3 py-8 text-center"
                    >
                      <FileAudio2 className="mb-1.5 h-5 w-5 text-muted-foreground/50" aria-hidden />
                      <p className="text-xs font-medium text-muted-foreground">{slot}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/60">Empty — no result</p>
                    </div>
                  ))}
                </div>
                <Button disabled className="mt-3 w-full">
                  Start separation
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Inactive by design — no model, no runtime, no simulated processing.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <>
          <EmptyState
            icon={MicOff}
            title="Select a track to process"
            description="Choose imported audio for separation. Processing remains unavailable until a model is installed."
          />
          <div className="mx-auto mt-4 max-w-xl">
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to process" />
          </div>
        </>
      )}
    </div>
  );
}
