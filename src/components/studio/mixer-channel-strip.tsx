"use client";

/**
 * Multi-Track Channel Strip Component
 *
 * Provides DAW-style channel fader, stereo panning, solo/mute buttons,
 * offset timing adjustments, and DSP rack access.
 */

import { useState } from "react";
import { Sliders, Volume2, VolumeX, Trash2, Compass, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SpatialPannerCanvas } from "./spatial-panner-canvas";
import { DEFAULT_SPATIAL_POSITION, type SpatialPosition } from "@/lib/studio/spatial-audio";
import type { TrackLane } from "@/lib/studio/store-mixer";
import { cn } from "@/lib/utils";

interface MixerChannelStripProps {
  lane: TrackLane;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<TrackLane>) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleSpatial?: () => void;
  onUpdateSpatial?: (pos: Partial<SpatialPosition>) => void;
  onRemove: () => void;
}

export function MixerChannelStrip({
  lane,
  isSelected,
  onSelect,
  onUpdate,
  onToggleMute,
  onToggleSolo,
  onToggleSpatial,
  onUpdateSpatial,
  onRemove,
}: MixerChannelStripProps) {
  const panLabel =
    lane.pan === 0
      ? "C"
      : lane.pan < 0
      ? `L${Math.round(Math.abs(lane.pan) * 100)}`
      : `R${Math.round(lane.pan * 100)}`;

  const fxActiveCount =
    (lane.effects.eq.enabled ? 1 : 0) +
    (lane.effects.compressor.enabled ? 1 : 0) +
    (lane.effects.limiter.enabled ? 1 : 0);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex flex-col justify-between w-28 shrink-0 rounded-lg border p-2.5 transition-all cursor-pointer bg-card/60 select-none",
        isSelected ? "border-primary ring-1 ring-primary/40 shadow-sm" : "border-border/60 hover:border-border"
      )}
    >
      {/* Top: Header & Color */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-semibold" title={lane.name}>
            {lane.name}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove lane"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className={cn(
              "h-6 flex-1 px-1 text-[10px] font-bold",
              lane.muted ? "bg-amber-500 text-amber-950 font-black border-amber-500 hover:bg-amber-400" : "hover:bg-muted"
            )}
            title="Mute track"
          >
            M
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSolo();
            }}
            className={cn(
              "h-6 flex-1 px-1 text-[10px] font-bold",
              lane.solo ? "bg-primary text-primary-foreground font-black border-primary hover:bg-primary/90" : "hover:bg-muted"
            )}
            title="Solo track"
          >
            S
          </Button>
        </div>
      </div>

      {/* Middle: Pan & Volume Fader */}
      <div className="my-3 space-y-3">
        {/* Pan or 3D Spatial Radar */}
        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              {lane.spatialEnabled ? "3D Pos" : "Pan"}
            </span>
            <button
              type="button"
              onClick={onToggleSpatial}
              className={cn(
                "p-0.5 rounded text-[9px] font-mono hover:text-foreground transition-colors",
                lane.spatialEnabled ? "text-primary font-bold" : "text-muted-foreground/60"
              )}
              title={lane.spatialEnabled ? "Switch to standard Stereo Pan" : "Switch to 3D Binaural Spatial Panner"}
            >
              {lane.spatialEnabled ? "3D" : "2D"}
            </button>
          </div>

          {lane.spatialEnabled ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-[10px] px-1 font-mono gap-1 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                >
                  <Compass className="h-3 w-3" />
                  {lane.spatialPosition?.azimuthDeg ?? 0}° / {lane.spatialPosition?.distanceMeters ?? 1}m
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 border-border" align="center">
                <SpatialPannerCanvas
                  trackName={lane.name}
                  position={lane.spatialPosition ?? DEFAULT_SPATIAL_POSITION}
                  onChange={(pos) => onUpdateSpatial?.(pos)}
                />
              </PopoverContent>
            </Popover>
          ) : (
            <>
              <div className="flex justify-end text-[9px] font-mono text-muted-foreground -mt-1 mb-0.5">
                <span>{panLabel}</span>
              </div>
              <Slider
                min={-1}
                max={1}
                step={0.05}
                value={[lane.pan]}
                onValueChange={([v]) => onUpdate({ pan: v })}
                className="h-3"
              />
            </>
          )}
        </div>

        {/* Volume Fader */}
        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Vol</span>
            <span className="font-mono font-medium">
              {lane.gainDb > 0 ? `+${lane.gainDb.toFixed(1)}` : `${lane.gainDb.toFixed(1)}`} dB
            </span>
          </div>
          <Slider
            min={-48}
            max={6}
            step={0.5}
            value={[lane.gainDb]}
            onValueChange={([v]) => onUpdate({ gainDb: v })}
            className="h-24 py-1"
          />
        </div>
      </div>

      {/* Bottom: Offset & FX badge */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Offset</span>
          <span className="font-mono">{lane.offsetSec.toFixed(2)}s</span>
        </div>

        <Badge
          variant="outline"
          className={cn(
            "w-full justify-center h-5 text-[10px] gap-1 font-medium",
            fxActiveCount > 0 ? "border-primary/50 text-primary bg-primary/5" : "text-muted-foreground"
          )}
        >
          <Sliders className="h-2.5 w-2.5" />
          {fxActiveCount > 0 ? `${fxActiveCount} FX Active` : "No FX"}
        </Badge>
      </div>
    </div>
  );
}
