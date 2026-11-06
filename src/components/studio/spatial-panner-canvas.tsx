"use client";

/**
 * 3D Binaural Soundstage Radar Canvas
 *
 * Interactive circular radar display for positioning audio sources in 3D binaural
 * space. Supports real-time drag-and-drop, azimuth/elevation/distance readouts,
 * Woodworth ITD delay displays, and quick soundstage presets.
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Compass, Headphones, Volume2, Move, Sparkles } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type SpatialPosition,
  calculateWoodworthItdMs,
  sphericalToCartesian,
} from "@/lib/studio/spatial-audio";

interface SpatialPannerCanvasProps {
  position: SpatialPosition;
  onChange: (pos: Partial<SpatialPosition>) => void;
  trackName?: string;
  colorClass?: string;
  className?: string;
}

export function SpatialPannerCanvas({
  position,
  onChange,
  trackName = "Track Source",
  colorClass = "bg-primary text-primary-foreground",
  className = "",
}: SpatialPannerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { azimuthDeg, elevationDeg, distanceMeters } = position;
  const itdMs = calculateWoodworthItdMs(azimuthDeg);
  const cartesian = sphericalToCartesian(position);

  // Soundstage presets
  const presets = [
    { label: "Center Front", az: 0, el: 0, dist: 1.0 },
    { label: "Left Ear", az: -90, el: 0, dist: 0.8 },
    { label: "Right Ear", az: 90, el: 0, dist: 0.8 },
    { label: "Overhead", az: 0, el: 75, dist: 1.5 },
    { label: "Behind Left", az: -135, el: 0, dist: 1.2 },
    { label: "Behind Right", az: 135, el: 0, dist: 1.2 },
  ];

  // Draw the 3D Radar soundstage
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(cx, cy) - 16;

    ctx.clearRect(0, 0, width, height);

    // 1. Background disc
    ctx.fillStyle = "rgba(15, 23, 42, 0.4)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 2. Concentric distance rings (1m, 3m, 5m)
    const ringDistances = [0.25, 0.5, 0.75, 1.0];
    ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
    ctx.lineWidth = 1;

    ringDistances.forEach((fraction) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * fraction, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 3. Crosshair axes
    ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.stroke();

    // 4. Orientation ticks & labels
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText("FRONT (0°)", cx, cy - radius + 8);
    ctx.fillText("BACK (180°)", cx, cy + radius - 8);
    ctx.textAlign = "left";
    ctx.fillText("R (+90°)", cx + radius - 38, cy - 6);
    ctx.textAlign = "right";
    ctx.fillText("L (-90°)", cx - radius + 38, cy - 6);

    // 5. Listener Head Icon at center
    ctx.fillStyle = "#8b5cf6"; // Violet listener
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();

    // Listener nose arrow pointing towards Front (0°)
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy - 6);
    ctx.lineTo(cx, cy - 12);
    ctx.lineTo(cx + 3, cy - 6);
    ctx.closePath();
    ctx.fillStyle = "#a78bfa";
    ctx.fill();

    // 6. Sound Source Node Position
    // Map distance (0.2m..10m) to radius fraction (0.1..1.0)
    const normalizedDist = Math.min(1.0, Math.max(0.1, distanceMeters / 6.0));
    const puckRadius = radius * normalizedDist;

    // Azimuth 0 is Up (-Y), 90 is Right (+X), -90 is Left (-X)
    const radAz = ((azimuthDeg - 90) * Math.PI) / 180;
    const puckX = cx + puckRadius * Math.cos(radAz);
    const puckY = cy + puckRadius * Math.sin(radAz);

    // Distance line from listener to source
    ctx.strokeStyle = "rgba(139, 92, 246, 0.4)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(puckX, puckY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sound Source Glow Aura
    const gradient = ctx.createRadialGradient(puckX, puckY, 2, puckX, puckY, 14);
    gradient.addColorStop(0, "rgba(56, 189, 248, 0.8)");
    gradient.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(puckX, puckY, 14, 0, Math.PI * 2);
    ctx.fill();

    // Sound Source Core Puck
    ctx.fillStyle = "#38bdf8"; // Sky blue
    ctx.beginPath();
    ctx.arc(puckX, puckY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [azimuthDeg, distanceMeters]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Handle pointer interactions on the radar
  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const maxR = Math.min(cx, cy) - 16;

    const px = e.clientX - rect.left - cx;
    const py = e.clientY - rect.top - cy;

    // Calculate azimuth in degrees: 0° is straight up (-Y), 90° is right (+X)
    let angleRad = Math.atan2(px, -py);
    let deg = Math.round((angleRad * 180) / Math.PI);
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;

    // Calculate distance (0.2m to 6.0m)
    const distPx = Math.sqrt(px * px + py * py);
    const distNorm = Math.min(1.0, Math.max(0.1, distPx / maxR));
    const distMeters = Number((distNorm * 6.0).toFixed(1));

    onChange({
      azimuthDeg: deg,
      distanceMeters: Math.max(0.3, distMeters),
    });
  };

  return (
    <div className={`p-4 rounded-xl border border-border bg-card/60 backdrop-blur space-y-3.5 ${className}`}>
      {/* Soundstage Header & Source Identification */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">{trackName}</span>
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
            3D Binaural HRTF
          </Badge>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
          <Compass className="h-3 w-3" />
          ITD: {Math.round(itdMs * 1000)} µs
        </span>
      </div>

      {/* Radar Canvas with Top-Down View */}
      <div className="flex justify-center relative">
        <canvas
          ref={canvasRef}
          width={220}
          height={220}
          onPointerDown={(e) => {
            setIsDragging(true);
            handlePointer(e);
          }}
          onPointerMove={(e) => {
            if (isDragging) handlePointer(e);
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerLeave={() => setIsDragging(false)}
          className="rounded-full border border-border/80 bg-background/50 cursor-crosshair touch-none shadow-inner"
          title="Drag to position audio source in 3D soundstage"
        />
        <div className="absolute bottom-2 left-2 text-[9px] font-mono text-muted-foreground/70 pointer-events-none">
          X: {cartesian.x}m · Y: {cartesian.y}m · Z: {cartesian.z}m
        </div>
      </div>

      {/* Numerical Sliders & Controls */}
      <div className="space-y-2.5 pt-1 text-xs">
        {/* Azimuth Angle */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Azimuth Angle</span>
            <span className="font-mono font-medium">{azimuthDeg}° ({azimuthDeg < 0 ? "Left" : azimuthDeg > 0 ? "Right" : "Center"})</span>
          </div>
          <Slider
            min={-180}
            max={180}
            step={1}
            value={[azimuthDeg]}
            onValueChange={([val]) => onChange({ azimuthDeg: val })}
            className="w-full"
          />
        </div>

        {/* Distance Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Soundstage Distance</span>
            <span className="font-mono font-medium">{distanceMeters.toFixed(1)} meters</span>
          </div>
          <Slider
            min={0.2}
            max={10.0}
            step={0.1}
            value={[distanceMeters]}
            onValueChange={([val]) => onChange({ distanceMeters: val })}
            className="w-full"
          />
        </div>

        {/* Elevation Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Vertical Elevation</span>
            <span className="font-mono font-medium">{elevationDeg}° ({elevationDeg > 0 ? "Above" : elevationDeg < 0 ? "Below" : "Ear Level"})</span>
          </div>
          <Slider
            min={-90}
            max={90}
            step={1}
            value={[elevationDeg]}
            onValueChange={([val]) => onChange({ elevationDeg: val })}
            className="w-full"
          />
        </div>
      </div>

      {/* Quick Presets Buttons */}
      <div className="pt-2 border-t border-border/80">
        <div className="text-[10px] text-muted-foreground mb-1.5 font-medium flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-primary" /> Soundstage Presets
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-1 truncate"
              onClick={() =>
                onChange({
                  azimuthDeg: p.az,
                  elevationDeg: p.el,
                  distanceMeters: p.dist,
                })
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
