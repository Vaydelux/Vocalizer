"use client";

/**
 * Splitter — stem separation workspace (2/4/6-stem ready).
 * Stem sets must come from installed model metadata; with no model installed,
 * only clearly-labeled example labels are shown and nothing is executable.
 */

import { useState } from "react";
import { Split, ShieldAlert, FileAudio2 } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { TrackSelect } from "@/components/studio/track-select";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTrackById } from "@/lib/studio/store-tracks";
import { useUi } from "@/lib/studio/store-ui";
import { useModels } from "@/lib/studio/store-models";
import { useSettings } from "@/lib/studio/store-settings";
import { MODEL_STEM_LABELS } from "@/lib/studio/schemas";
import { formatTime } from "@/lib/studio/format";

export function SplitterView() {
  const preselected = useUi((s) => s.preselectedTrackId);
  const [trackId, setTrackId] = useState<string | null>(preselected);
  const track = trackId ? getTrackById(trackId) : undefined;

  const userModels = useModels((s) => s.userModels);
  const builtin = useModels((s) => s.builtin);
  const preferredModelId = useSettings((s) => s.preferredModelId);

  // Stems would be read from the selected model's manifest — never assumed.
  const selectedModel = userModels.find((m) => m.manifest.modelId === preferredModelId);
  const modelStems = selectedModel ? selectedModel.manifest.supportedStems : null;

  return (
    <div>
      <PageHeader
        title="Splitter"
        description="Multi-stem separation (two-, four-, and six-stem where a model supports it). Supported stems are read from model metadata — never guessed."
      />

      {track ? (
        <div className="space-y-4">
          <div className="max-w-xl">
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to split" />
            {track.meta && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatTime(track.meta.duration)} · {track.meta.sampleRate ?? "?"} Hz · {track.meta.channels ?? "?"} ch
              </p>
            )}
          </div>

          <CapabilityBanner tone="unavailable" title="Audio separation is not available yet. Install a compatible model when AI processing support is enabled.">
            No separation model is installed (the built-in slot “{builtin.name}” ships in a later
            phase). Stem layouts will appear here from the installed model’s manifest.
          </CapabilityBanner>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stem layout</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {modelStems ? (
                  <div className="flex flex-wrap gap-2">
                    {modelStems.map((s) => (
                      <span key={s} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {MODEL_STEM_LABELS.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground/60"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Example labels from the manifest standard — shown greyed out because no model is
                      installed. Unsupported stems are never exposed as working outputs.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Result slots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-3 py-10 text-center">
                  <FileAudio2 className="mr-2 h-5 w-5 text-muted-foreground/50" aria-hidden />
                  <p className="text-xs text-muted-foreground">
                    Stem slots appear here after a real, successful separation — never before.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <>
          <EmptyState
            icon={Split}
            title="Select a track to split"
            description="Choose imported audio. Separation stays inactive until a compatible model and runtime are installed."
          />
          <div className="mx-auto mt-4 max-w-xl">
            <TrackSelect value={trackId} onChange={setTrackId} ariaLabel="Track to split" />
          </div>
        </>
      )}
    </div>
  );
}
