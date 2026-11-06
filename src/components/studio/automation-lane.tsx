"use client";

/**
 * Interactive Timeline Automation Lane & Breakpoint Curve Editor
 *
 * Renders an interactive canvas underneath arrangement timeline lanes for drawing,
 * moving, and deleting automation breakpoints with smooth cubic Hermite curves,
 * linear ramps, or step-holds.
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Sliders,
  Trash2,
  Plus,
  Sparkles,
  TrendingUp,
  Activity,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AutomationPoint,
  type AutomationTarget,
  AUTOMATION_TARGET_CONFIGS,
} from "@/lib/studio/automation";

interface AutomationLaneProps {
  laneId: string;
  trackName: string;
  durationSec: number;
  points: AutomationPoint[];
  target: AutomationTarget;
  onTargetChange: (target: AutomationTarget) => void;
  onAddPoint: (point: Omit<AutomationPoint, "id">) => void;
  onUpdatePoint: (pointId: string, patch: Partial<AutomationPoint>) => void;
  onRemovePoint: (pointId: string) => void;
  onClearPoints: () => void;
}

export function AutomationLane({
  laneId,
  trackName,
  durationSec,
  points,
  target,
  onTargetChange,
  onAddPoint,
  onUpdatePoint,
  onRemovePoint,
  onClearPoints,
}: AutomationLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; timeSec: number; val: number } | null>(null);

  const config = AUTOMATION_TARGET_CONFIGS[target];
  const maxDuration = Math.max(5.0, durationSec || 30.0);

  // Coordinate mapping
  const timeToX = useCallback((t: number, width: number) => {
    const pad = 12;
    return pad + (Math.max(0, Math.min(t, maxDuration)) / maxDuration) * (width - pad * 2);
  }, [maxDuration]);

  const xToTime = useCallback((x: number, width: number) => {
    const pad = 12;
    const clampedX = Math.max(pad, Math.min(x, width - pad));
    return Number((((clampedX - pad) / (width - pad * 2)) * maxDuration).toFixed(2));
  }, [maxDuration]);

  const valueToY = useCallback((val: number, height: number) => {
    const pad = 12;
    const norm = (val - config.min) / (config.max - config.min); // 0..1
    return height - pad - norm * (height - pad * 2); // Invert Y (top is high)
  }, [config.min, config.max]);

  const yToValue = useCallback((y: number, height: number) => {
    const pad = 12;
    const clampedY = Math.max(pad, Math.min(y, height - pad));
    const norm = (height - pad - clampedY) / (height - pad * 2);
    const rawVal = config.min + norm * (config.max - config.min);
    return Number(rawVal.toFixed(1));
  }, [config.min, config.max]);

  // Render the curve on HTML5 Canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Background grid lines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
    ctx.lineWidth = 1;

    // Horizontal grid lines (Min, Center, Max)
    const yCenter = valueToY((config.min + config.max) / 2, height);
    const yMax = valueToY(config.max, height);
    const yMin = valueToY(config.min, height);

    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yMax);
    ctx.lineTo(width, yMax);
    ctx.moveTo(0, yCenter);
    ctx.lineTo(width, yCenter);
    ctx.moveTo(0, yMin);
    ctx.lineTo(width, yMin);
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertical time grid lines (every 5 seconds)
    const stepSec = maxDuration <= 15 ? 2 : maxDuration <= 60 ? 5 : 15;
    ctx.font = "9px monospace";
    ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
    ctx.textAlign = "center";

    for (let t = 0; t <= maxDuration; t += stepSec) {
      const gx = timeToX(t, width);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
      ctx.fillText(`${t}s`, gx, height - 2);
    }

    // 2. Breakpoint Curve Drawing
    const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec);

    if (sorted.length > 0) {
      ctx.strokeStyle = "#8b5cf6"; // Violet primary
      ctx.lineWidth = 2;
      ctx.beginPath();

      // Lead-in from t=0
      const firstX = timeToX(sorted[0].timeSec, width);
      const firstY = valueToY(sorted[0].value, height);
      ctx.moveTo(0, firstY);
      ctx.lineTo(firstX, firstY);

      for (let i = 0; i < sorted.length - 1; i++) {
        const p0 = sorted[i];
        const p1 = sorted[i + 1];
        const x0 = timeToX(p0.timeSec, width);
        const y0 = valueToY(p0.value, height);
        const x1 = timeToX(p1.timeSec, width);
        const y1 = valueToY(p1.value, height);

        if (p0.curveType === "hold") {
          ctx.lineTo(x1, y0);
          ctx.lineTo(x1, y1);
        } else if (p0.curveType === "bezier") {
          // Smooth S-curve cubic bezier
          const cpX1 = x0 + (x1 - x0) * 0.45;
          const cpY1 = y0;
          const cpX2 = x0 + (x1 - x0) * 0.55;
          const cpY2 = y1;
          ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x1, y1);
        } else {
          // Linear
          ctx.lineTo(x1, y1);
        }
      }

      // Lead-out to end of track
      const lastX = timeToX(sorted[sorted.length - 1].timeSec, width);
      const lastY = valueToY(sorted[sorted.length - 1].value, height);
      ctx.lineTo(width, lastY);
      ctx.stroke();

      // Shaded area under curve
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const areaGrad = ctx.createLinearGradient(0, 0, 0, height);
      areaGrad.addColorStop(0, "rgba(139, 92, 246, 0.15)");
      areaGrad.addColorStop(1, "rgba(139, 92, 246, 0.0)");
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // 3. Node pucks
      sorted.forEach((p) => {
        const px = timeToX(p.timeSec, width);
        const py = valueToY(p.value, height);
        const isSelected = p.id === selectedPointId;
        const isHovered = p.id === hoveredPointId;

        // Outer glow on hover or select
        if (isSelected || isHovered) {
          ctx.fillStyle = "rgba(167, 139, 250, 0.4)";
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.fill();
        }

        // Inner node
        ctx.fillStyle = isSelected ? "#ffffff" : "#c4b5fd";
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }, [points, maxDuration, timeToX, valueToY, config.min, config.max, selectedPointId, hoveredPointId]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Sync canvas size with container width
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = 100;
      draw();
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  // Pointer event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Check if clicked near an existing node
    const hitRadius = 10;
    const hit = points.find((p) => {
      const px = timeToX(p.timeSec, canvas.width);
      const py = valueToY(p.value, canvas.height);
      return Math.hypot(cx - px, cy - py) <= hitRadius;
    });

    if (hit) {
      setSelectedPointId(hit.id);
      setDraggingPointId(hit.id);
    } else {
      // Add new point at clicked location
      const newTime = xToTime(cx, canvas.width);
      const newVal = yToValue(cy, canvas.height);
      onAddPoint({
        timeSec: newTime,
        value: newVal,
        curveType: "linear",
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const timeSec = xToTime(cx, canvas.width);
    const val = yToValue(cy, canvas.height);
    setCursorPos({ x: cx, y: cy, timeSec, val });

    if (draggingPointId) {
      onUpdatePoint(draggingPointId, {
        timeSec,
        value: val,
      });
    } else {
      const hitRadius = 10;
      const hit = points.find((p) => {
        const px = timeToX(p.timeSec, canvas.width);
        const py = valueToY(p.value, canvas.height);
        return Math.hypot(cx - px, cy - py) <= hitRadius;
      });
      setHoveredPointId(hit ? hit.id : null);
    }
  };

  const handlePointerUp = () => {
    setDraggingPointId(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const hit = points.find((p) => {
      const px = timeToX(p.timeSec, canvas.width);
      const py = valueToY(p.value, canvas.height);
      return Math.hypot(cx - px, cy - py) <= 10;
    });

    if (hit) {
      onRemovePoint(hit.id);
      setSelectedPointId(null);
    }
  };

  // Quick automation curve presets
  const applyPreset = (presetName: string) => {
    onClearPoints();
    if (presetName === "fadeIn") {
      onAddPoint({ timeSec: 0, value: config.min, curveType: "bezier" });
      onAddPoint({ timeSec: 2.5, value: config.defaultValue, curveType: "linear" });
    } else if (presetName === "fadeOut") {
      const startT = Math.max(0, maxDuration - 3.5);
      onAddPoint({ timeSec: startT, value: config.defaultValue, curveType: "bezier" });
      onAddPoint({ timeSec: maxDuration, value: config.min, curveType: "linear" });
    } else if (presetName === "ducking") {
      onAddPoint({ timeSec: 1.0, value: config.defaultValue, curveType: "bezier" });
      onAddPoint({ timeSec: 1.8, value: -9.0, curveType: "linear" });
      onAddPoint({ timeSec: 4.5, value: -9.0, curveType: "bezier" });
      onAddPoint({ timeSec: 5.5, value: config.defaultValue, curveType: "linear" });
    } else if (presetName === "filterSweep") {
      onAddPoint({ timeSec: 0, value: 20000, curveType: "linear" });
      onAddPoint({ timeSec: 2.5, value: 800, curveType: "bezier" });
      onAddPoint({ timeSec: 5.0, value: 20000, curveType: "linear" });
    }
  };

  const selectedPoint = points.find((p) => p.id === selectedPointId);

  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-2.5 space-y-2 mt-1 select-none">
      {/* Header controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Sliders className="h-3.5 w-3.5 text-primary" />
          <Select value={target} onValueChange={(t: AutomationTarget) => onTargetChange(t)}>
            <SelectTrigger className="h-6 w-36 text-[11px] font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="volume" className="text-xs">Volume Envelope (dB)</SelectItem>
              <SelectItem value="pan" className="text-xs">Stereo Pan (-1..+1)</SelectItem>
              <SelectItem value="lowpassCutoff" className="text-xs">Low-Pass Filter (Hz)</SelectItem>
              <SelectItem value="azimuth" className="text-xs">3D Spatial Azimuth (°)</SelectItem>
            </SelectContent>
          </Select>

          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
            {points.length} nodes
          </Badge>
        </div>

        {/* Selected Node Curve Type Selector */}
        {selectedPoint && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>Curve:</span>
            <div className="flex gap-1">
              {(["linear", "bezier", "hold"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onUpdatePoint(selectedPoint.id, { curveType: type })}
                  className={`px-1.5 py-0.5 rounded capitalize border transition-colors ${
                    selectedPoint.curveType === type
                      ? "border-primary bg-primary/20 text-foreground font-semibold"
                      : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={() => {
                onRemovePoint(selectedPoint.id);
                setSelectedPointId(null);
              }}
              title="Delete node"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Presets and actions */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => applyPreset("fadeIn")}
          >
            Fade In
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => applyPreset("fadeOut")}
          >
            Fade Out
          </Button>
          {target === "volume" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => applyPreset("ducking")}
            >
              Duck
            </Button>
          )}
          {target === "lowpassCutoff" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => applyPreset("filterSweep")}
            >
              Sweep
            </Button>
          )}
          {points.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-destructive"
              onClick={onClearPoints}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Interactive Canvas */}
      <div ref={containerRef} className="relative w-full overflow-hidden rounded bg-black/30 border border-border/40">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          className="w-full cursor-crosshair touch-none"
          title="Click to add node. Drag node to move. Double-click node to delete."
        />

        {/* Live Hover Readout Badge */}
        {cursorPos && (
          <div className="absolute top-1 left-2 pointer-events-none font-mono text-[9px] text-muted-foreground/80 bg-background/80 px-1.5 py-0.5 rounded border border-border/40">
            {cursorPos.timeSec.toFixed(2)}s · {config.formatDisplay(cursorPos.val)}
          </div>
        )}
      </div>
    </div>
  );
}
