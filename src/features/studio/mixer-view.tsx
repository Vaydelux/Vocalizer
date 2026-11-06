"use client";

/**
 * Multi-Track Mixer & Arrangement View (DAW-Lite)
 *
 * Professional multi-lane audio mixing console with arrangement timeline,
 * channel strip faders, stereo panning, solo/mute matrices, real-time DSP racks,
 * and 1-click master mixdown export with broadcast loudness normalization.
 */

import { useState, useMemo, useCallback } from "react";
import {
  Layers,
  Plus,
  Play,
  Square,
  Sliders,
  Volume2,
  Trash2,
  Sparkles,
  Download,
  Gauge,
  Headphones,
  Compass,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { ExportFormatSelect, useExportFormatDefault, type ExportFormatValue } from "@/components/studio/export-format-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMixer, isLaneAudible, type TrackLane } from "@/lib/studio/store-mixer";
import { useTracks, getTrackById } from "@/lib/studio/store-tracks";
import { hasUsableTrackAudio } from "@/lib/studio/native-stem-track";
import { useJobs } from "@/lib/studio/store-jobs";
import { makeMultitrackTask } from "@/lib/studio/tasks";
import { MixerChannelStrip } from "@/components/studio/mixer-channel-strip";
import { DspRack } from "@/components/studio/dsp-rack";
import { SpatialPannerCanvas } from "@/components/studio/spatial-panner-canvas";
import { DEFAULT_SPATIAL_POSITION } from "@/lib/studio/spatial-audio";
import { AutomationLane } from "@/components/studio/automation-lane";
import { type AutomationTarget } from "@/lib/studio/automation";
import { InlineJob } from "@/components/studio/inline-job";
import { formatTime } from "@/lib/studio/format";
import { cn } from "@/lib/utils";

export function MixerView() {
  const lanes = useMixer((s) => s.lanes);
  const masterGainDb = useMixer((s) => s.masterGainDb);
  const masterEffects = useMixer((s) => s.masterEffects);
  const masterMode = useMixer((s) => s.masterMode);
  const selectedLaneId = useMixer((s) => s.selectedLaneId);
  const addLane = useMixer((s) => s.addLane);
  const removeLane = useMixer((s) => s.removeLane);
  const updateLane = useMixer((s) => s.updateLane);
  const updateLaneEffects = useMixer((s) => s.updateLaneEffects);
  const updateLaneSpatial = useMixer((s) => s.updateLaneSpatial);
  const toggleLaneSpatial = useMixer((s) => s.toggleLaneSpatial);
  const toggleLaneAutomation = useMixer((s) => s.toggleLaneAutomation);
  const setLaneAutomationPoint = useMixer((s) => s.setLaneAutomationPoint);
  const updateLaneAutomationPoint = useMixer((s) => s.updateLaneAutomationPoint);
  const removeLaneAutomationPoint = useMixer((s) => s.removeLaneAutomationPoint);
  const clearLaneAutomation = useMixer((s) => s.clearLaneAutomation);
  const toggleMute = useMixer((s) => s.toggleMute);
  const toggleSolo = useMixer((s) => s.toggleSolo);
  const setSelectedLane = useMixer((s) => s.setSelectedLane);
  const setMasterMode = useMixer((s) => s.setMasterMode);
  const updateMasterGain = useMixer((s) => s.updateMasterGain);
  const updateMasterEffects = useMixer((s) => s.updateMasterEffects);
  const clearAllLanes = useMixer((s) => s.clearAllLanes);

  const tracks = useTracks((s) => s.tracks);
  const readyTracks = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);
  const jobsEnqueue = useJobs((s) => s.enqueue);

  const [fmt, setFmt] = useState<ExportFormatValue>(useExportFormatDefault());
  const [loudnorm, setLoudnorm] = useState(true);
  const [selectedAddTrackId, setSelectedAddTrackId] = useState<string>("");
  const [laneTargets, setLaneTargets] = useState<Record<string, AutomationTarget>>({});

  const selectedLane = lanes.find((l) => l.id === selectedLaneId) ?? lanes[0];

  const handleAddTrack = () => {
    if (!selectedAddTrackId) return;
    addLane(selectedAddTrackId);
    toast.success("Track added to mixer lane");
    setSelectedAddTrackId("");
  };

  const handleBounceMaster = useCallback(() => {
    if (lanes.length === 0) return;

    // Filter only audible lanes
    const audibleLanes = lanes.filter((l) => isLaneAudible(l, lanes));
    if (audibleLanes.length === 0) {
      toast.error("No audible lanes", { description: "All tracks are either muted or suppressed by solo." });
      return;
    }

    const missingLanes = audibleLanes.filter((lane) => {
      const track = getTrackById(lane.trackId);
      return !track || !hasUsableTrackAudio(track);
    });
    if (missingLanes.length > 0) {
      toast.error("Mixdown blocked: original audio is missing", {
        description: `${missingLanes.length} mixer lane(s) need validated audio. Use Relink Audio in the project bar first.`,
      });
      return;
    }

    const taskLanes = audibleLanes
      .map((l) => {
        const track = getTrackById(l.trackId);
        if (!track) return null;
        return {
          track,
          offsetSec: l.offsetSec,
          gainDb: l.gainDb,
          pan: l.pan,
          effects: l.effects,
          spatialEnabled: l.spatialEnabled,
          spatialPosition: l.spatialPosition,
          automationLanes: l.automationLanes,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (taskLanes.length === 0) {
      toast.error("Missing audio track data");
      return;
    }

    const modeLabel = masterMode === "surround51" ? "5.1 Surround" : masterMode === "binaural" ? "3D Binaural" : "Stereo";
    const label = `Mixdown (${taskLanes.length} lanes) → Master [${modeLabel}]`;
    jobsEnqueue(
      "export",
      label + (loudnorm ? " [EBU R128]" : ""),
      makeMultitrackTask({
        lanes: taskLanes,
        masterGainDb,
        masterEffects,
        masterMode,
        loudnessNormalize: loudnorm ? { targetLufs: -14, truePeak: -1.0 } : undefined,
        defaultName: `master_mixdown_${masterMode}`,
        format: fmt.format,
        mp3Bitrate: fmt.mp3Bitrate,
      })
    );
    toast.info(`Master mixdown queued (${modeLabel})`);
  }, [lanes, masterGainDb, masterEffects, masterMode, loudnorm, fmt, jobsEnqueue]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Multi-Track Mixer"
        description="Arrange, balance, pan, and apply studio DSP effect chains across multiple tracks. 1-click master mixdown export with broadcast loudness normalization."
      />

      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedAddTrackId} onValueChange={setSelectedAddTrackId}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Select track to add..." />
            </SelectTrigger>
            <SelectContent>
              {readyTracks.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            onClick={handleAddTrack}
            disabled={!selectedAddTrackId}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add Lane
          </Button>

          {lanes.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAllLanes}
              className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1"
            >
              <Trash2 className="h-3 w-3" /> Clear All
            </Button>
          )}
        </div>

        {/* Master Bounce Button */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleBounceMaster}
            disabled={lanes.length === 0}
            className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
          >
            <Download className="h-3.5 w-3.5" /> Bounce Master
          </Button>
        </div>
      </div>

      {lanes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No tracks in mixer"
          description="Add one or more tracks from your audio library above to begin balancing and mixing."
        />
      ) : (
        <div className="space-y-5">
          {/* Main Console Bay */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left 2 Cols: Channel Strip Bay & Timeline Offsets */}
            <div className="lg:col-span-2 space-y-4">
              {/* Channel Strip Console */}
              <Card>
                <CardHeader className="py-2.5 px-3 border-b border-border/40">
                  <CardTitle className="text-xs font-semibold flex items-center justify-between">
                    <span>Mixer Console ({lanes.length} channels)</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Click channel to inspect DSP FX
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="flex items-stretch gap-2.5 overflow-x-auto pb-2">
                    {lanes.map((lane) => (
                      <MixerChannelStrip
                        key={lane.id}
                        lane={lane}
                        isSelected={selectedLane?.id === lane.id}
                        onSelect={() => setSelectedLane(lane.id)}
                        onUpdate={(patch) => updateLane(lane.id, patch)}
                        onToggleMute={() => toggleMute(lane.id)}
                        onToggleSolo={() => toggleSolo(lane.id)}
                        onToggleSpatial={() => toggleLaneSpatial(lane.id)}
                        onUpdateSpatial={(patch) => updateLaneSpatial(lane.id, patch)}
                        onRemove={() => removeLane(lane.id)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Arrangement Timing Offsets & Automation */}
              <Card>
                <CardHeader className="py-2.5 px-3 border-b border-border/40">
                  <CardTitle className="text-xs font-semibold flex items-center justify-between">
                    <span>Arrangement Timeline Offsets & Automation</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Click Auto to draw volume/pan/filter curves
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  {lanes.map((lane) => {
                    const track = getTrackById(lane.trackId);
                    const dur = track?.meta?.duration ?? 0;
                    const pointCount =
                      lane.automationLanes?.reduce((acc, al) => acc + al.points.length, 0) ?? 0;
                    const activeTarget = laneTargets[lane.id] ?? "volume";
                    const currentPoints =
                      lane.automationLanes?.find((al) => al.target === activeTarget)?.points ?? [];

                    return (
                      <div
                        key={lane.id}
                        className={cn(
                          "space-y-2 rounded-md border p-2.5 transition-colors",
                          lane.automationOpen
                            ? "border-primary/40 bg-muted/20"
                            : "border-border/40 bg-card/60"
                        )}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate max-w-[180px]">{lane.name}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-6 px-1.5 text-[10px] gap-1",
                                lane.automationOpen
                                  ? "bg-primary/20 text-primary font-semibold"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                              onClick={() => toggleLaneAutomation(lane.id)}
                            >
                              <TrendingUp className="h-3 w-3" />
                              Auto {pointCount > 0 ? `(${pointCount})` : ""}
                            </Button>
                          </div>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            Start: {lane.offsetSec.toFixed(2)}s | Length: {dur ? formatTime(dur) : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Slider
                            min={0}
                            max={60}
                            step={0.1}
                            value={[lane.offsetSec]}
                            onValueChange={([v]) => updateLane(lane.id, { offsetSec: v })}
                            className="flex-1"
                          />
                          <span className="w-14 text-right font-mono text-[11px] text-muted-foreground">
                            +{lane.offsetSec.toFixed(1)}s
                          </span>
                        </div>

                        {/* Expandable Automation Lane Canvas Editor */}
                        {lane.automationOpen && (
                          <div className="pt-2 border-t border-border/40">
                            <AutomationLane
                              laneId={lane.id}
                              trackName={lane.name}
                              durationSec={dur || 30}
                              points={currentPoints}
                              target={activeTarget}
                              onTargetChange={(target) =>
                                setLaneTargets((prev) => ({ ...prev, [lane.id]: target }))
                              }
                              onAddPoint={(pt) =>
                                setLaneAutomationPoint(lane.id, activeTarget, pt)
                              }
                              onUpdatePoint={(pointId, patch) =>
                                updateLaneAutomationPoint(lane.id, activeTarget, pointId, patch)
                              }
                              onRemovePoint={(pointId) =>
                                removeLaneAutomationPoint(lane.id, activeTarget, pointId)
                              }
                              onClearPoints={() => clearLaneAutomation(lane.id, activeTarget)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {/* Right 1 Col: Master Strip, 3D Soundstage & Inspector DSP Rack */}
            <div className="space-y-4">
              {/* Master Bus Card */}
              <Card className="border-primary/30">
                <CardHeader className="py-2.5 px-3 border-b border-border/40 bg-muted/20">
                  <CardTitle className="text-xs font-semibold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-primary" /> Master Bus
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {masterGainDb > 0 ? `+${masterGainDb.toFixed(1)}` : masterGainDb.toFixed(1)} dB
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Master Fader</span>
                      <span className="font-mono">{masterGainDb.toFixed(1)} dB</span>
                    </div>
                    <Slider
                      min={-48}
                      max={6}
                      step={0.5}
                      value={[masterGainDb]}
                      onValueChange={([v]) => updateMasterGain(v)}
                    />
                  </div>

                  {/* Spatial Master Mode Selector */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Headphones className="h-3.5 w-3.5 text-primary" /> Spatial Mixdown Format
                    </Label>
                    <Select value={masterMode} onValueChange={(m: "stereo" | "binaural" | "surround51") => setMasterMode(m)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stereo" className="text-xs">Standard Stereo 2.0</SelectItem>
                        <SelectItem value="binaural" className="text-xs">3D Binaural HRTF (Headphones)</SelectItem>
                        <SelectItem value="surround51" className="text-xs">5.1 Surround Sound Matrix</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-2.5">
                    <div className="space-y-0.5">
                      <Label htmlFor="mix-loudnorm" className="text-xs font-medium cursor-pointer">
                        EBU R128 Loudness Normalization
                      </Label>
                      <p className="text-[10px] text-muted-foreground">
                        Target -14 LUFS / -1.0 dBFS true peak
                      </p>
                    </div>
                    <Switch id="mix-loudnorm" checked={loudnorm} onCheckedChange={setLoudnorm} />
                  </div>

                  <ExportFormatSelect value={fmt} onChange={setFmt} />
                </CardContent>
              </Card>

              {/* 3D Soundstage Radar Canvas for Selected Lane */}
              {selectedLane && selectedLane.spatialEnabled && (
                <SpatialPannerCanvas
                  trackName={selectedLane.name}
                  position={selectedLane.spatialPosition ?? DEFAULT_SPATIAL_POSITION}
                  onChange={(patch) => updateLaneSpatial(selectedLane.id, patch)}
                />
              )}

              {/* Audition one selected source without materializing a Blob.
                  This is a single-lane preview, not a simulated master mix. */}
              {selectedLane && (() => {
                const source = getTrackById(selectedLane.trackId);
                if (!source || source.status !== "ready" || !source.url) return null;
                return (
                  <Card>
                    <CardHeader className="py-2.5 px-3 border-b border-border/40">
                      <CardTitle className="text-xs">Source Audition — {selectedLane.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-2">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <audio
                        key={source.id}
                        src={source.url}
                        controls
                        preload="metadata"
                        className="w-full"
                        aria-label={`Audition ${selectedLane.name}`}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {source.nativeStem
                          ? "File-backed source: audio streams from the verified local stem, without a renderer Blob copy."
                          : "Auditioning the original imported audio file."}
                        {" "}This previews one lane; Bounce Master exports the full mixed arrangement.
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Inspector DSP Rack */}
              {selectedLane && (
                <DspRack
                  title={`DSP FX: ${selectedLane.name}`}
                  chain={selectedLane.effects}
                  onChange={(patch) => updateLaneEffects(selectedLane.id, patch)}
                />
              )}
            </div>
          </div>

          {/* Export Queue Section */}
          <Card>
            <CardHeader className="py-2.5 px-3">
              <CardTitle className="text-xs font-semibold">Mixdown Queue (this session)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <JobListFor label="Mixdown" />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function JobListFor({ label }: { label: string }) {
  const jobs = useJobs((s) => s.jobs);
  const relevant = jobs.filter((j) => j.label.startsWith(label)).slice(-4).reverse();
  if (relevant.length === 0) {
    return <p className="text-xs text-muted-foreground">No mixdowns queued yet.</p>;
  }
  return (
    <>
      {relevant.map((j) => (
        <InlineJob key={j.id} jobId={j.id} />
      ))}
    </>
  );
}
