"use client";

/**
 * Enterprise Timeline Automation & Dynamic Parameter Envelopes (Phase 9)
 *
 * Implements piecewise breakpoint curves, cubic Hermite spline interpolation,
 * Web Audio AudioParam scheduling, and FFmpeg dynamic frame-eval expression
 * generation (volume=eval=frame, stereotools, lowpass).
 */

import { z } from "zod";

/* ------------------------------- Zod Schemas ------------------------------- */

export const automationTargetSchema = z.enum([
  "volume",
  "pan",
  "lowpassCutoff",
  "azimuth",
]);

export type AutomationTarget = z.infer<typeof automationTargetSchema>;

export const automationPointSchema = z.object({
  id: z.string(),
  timeSec: z.number().min(0),
  value: z.number(),
  curveType: z.enum(["linear", "bezier", "hold"]).default("linear"),
});

export type AutomationPoint = z.infer<typeof automationPointSchema>;

export const automationLaneSchema = z.object({
  id: z.string(),
  target: automationTargetSchema,
  enabled: z.boolean().default(true),
  points: z.array(automationPointSchema).default([]),
});

export type AutomationLane = z.infer<typeof automationLaneSchema>;

/* ---------------------------- Target Metadata ------------------------------ */

export interface AutomationTargetMeta {
  target: AutomationTarget;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  unit: string;
  formatDisplay: (val: number) => string;
}

export const AUTOMATION_TARGET_CONFIGS: Record<AutomationTarget, AutomationTargetMeta> = {
  volume: {
    target: "volume",
    label: "Volume Envelope",
    min: -48,
    max: 6,
    defaultValue: 0,
    unit: "dB",
    formatDisplay: (val) => `${val > 0 ? "+" : ""}${val.toFixed(1)} dB`,
  },
  pan: {
    target: "pan",
    label: "Stereo Pan",
    min: -1,
    max: 1,
    defaultValue: 0,
    unit: "",
    formatDisplay: (val) =>
      val === 0 ? "Center" : val < 0 ? `L${Math.round(Math.abs(val) * 100)}` : `R${Math.round(val * 100)}`,
  },
  lowpassCutoff: {
    target: "lowpassCutoff",
    label: "Low-Pass Cutoff",
    min: 100,
    max: 20000,
    defaultValue: 20000,
    unit: "Hz",
    formatDisplay: (val) => (val >= 1000 ? `${(val / 1000).toFixed(1)} kHz` : `${Math.round(val)} Hz`),
  },
  azimuth: {
    target: "azimuth",
    label: "3D Spatial Azimuth",
    min: -180,
    max: 180,
    defaultValue: 0,
    unit: "°",
    formatDisplay: (val) => `${Math.round(val)}°`,
  },
};

/* ------------------------- Interpolation Evaluator ------------------------- */

/**
 * Evaluates the value of an automation lane at any continuous timestamp.
 * Uses piecewise linear, cubic Hermite bezier (smooth S-curve), or instant step-hold.
 */
export function evaluateAutomationAtTime(
  points: AutomationPoint[],
  timeSec: number,
  defaultValue: number
): number {
  if (!points || points.length === 0) return defaultValue;

  // Ensure points are strictly ordered chronologically
  const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec);

  // Before the first point -> clamp to first value
  if (timeSec <= sorted[0].timeSec) {
    return sorted[0].value;
  }

  // After the last point -> clamp to last value
  const last = sorted[sorted.length - 1];
  if (timeSec >= last.timeSec) {
    return last.value;
  }

  // Find surrounding segment [p0, p1]
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];

    if (timeSec >= p0.timeSec && timeSec <= p1.timeSec) {
      const segDuration = p1.timeSec - p0.timeSec;
      if (segDuration <= 0.0001) return p1.value;

      const tNorm = (timeSec - p0.timeSec) / segDuration; // 0..1

      if (p0.curveType === "hold") {
        return p0.value;
      }

      if (p0.curveType === "bezier") {
        // Cubic Hermite smooth S-curve interpolation: 3t^2 - 2t^3
        const smoothT = tNorm * tNorm * (3 - 2 * tNorm);
        return p0.value + (p1.value - p0.value) * smoothT;
      }

      // Default: Linear interpolation
      return p0.value + (p1.value - p0.value) * tNorm;
    }
  }

  return defaultValue;
}

/* ------------------------- FFmpeg Filter Compiler -------------------------- */

/**
 * Translates an automation curve into pure dynamic FFmpeg audio filter expressions.
 * Supported targets:
 * - "volume": generates `volume=eval=frame:volume='...'`
 * - "pan": generates `stereotools=mpan='...'`
 * - "lowpassCutoff": generates `lowpass=f='...'`
 */
export function compileAutomationToFfmpegFilter(
  target: AutomationTarget,
  points: AutomationPoint[]
): string | null {
  if (!points || points.length === 0) return null;

  const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec);

  if (target === "volume") {
    // Convert dB to linear gain: 10^(dB / 20)
    if (sorted.length === 1) {
      const g = Math.pow(10, sorted[0].value / 20).toFixed(4);
      return `volume=${g}`;
    }

    const clauses: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i];
      const p1 = sorted[i + 1];
      const g0 = Math.pow(10, p0.value / 20);
      const g1 = Math.pow(10, p1.value / 20);
      const t0 = p0.timeSec.toFixed(3);
      const t1 = p1.timeSec.toFixed(3);
      const dt = (p1.timeSec - p0.timeSec).toFixed(3);

      if (p0.curveType === "hold") {
        clauses.push(`if(between(t,${t0},${t1}),${g0.toFixed(4)},`);
      } else {
        // Linear gain ramp: g0 + (g1 - g0)*(t - t0)/dt
        const dg = (g1 - g0).toFixed(4);
        clauses.push(`if(between(t,${t0},${t1}),${g0.toFixed(4)}+(${dg})*(t-${t0})/${dt},`);
      }
    }

    const firstGain = Math.pow(10, sorted[0].value / 20).toFixed(4);
    const lastGain = Math.pow(10, sorted[sorted.length - 1].value / 20).toFixed(4);
    const tFirst = sorted[0].timeSec.toFixed(3);

    // Assembly: if (t < tFirst) firstGain, else if (between...) ..., else lastGain
    let expr = `if(lt(t,${tFirst}),${firstGain},`;
    expr += clauses.join("");
    expr += `${lastGain}${")".repeat(clauses.length + 1)}`;

    return `volume=eval=frame:volume='${expr}'`;
  }

  if (target === "pan") {
    if (sorted.length === 1) {
      return `stereotools=mpan=${sorted[0].value.toFixed(3)}`;
    }

    const clauses: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i];
      const p1 = sorted[i + 1];
      const t0 = p0.timeSec.toFixed(3);
      const t1 = p1.timeSec.toFixed(3);
      const dt = (p1.timeSec - p0.timeSec).toFixed(3);
      const dp = (p1.value - p0.value).toFixed(3);

      clauses.push(`if(between(t,${t0},${t1}),${p0.value.toFixed(3)}+(${dp})*(t-${t0})/${dt},`);
    }

    const firstVal = sorted[0].value.toFixed(3);
    const lastVal = sorted[sorted.length - 1].value.toFixed(3);
    const tFirst = sorted[0].timeSec.toFixed(3);

    let expr = `if(lt(t,${tFirst}),${firstVal},`;
    expr += clauses.join("");
    expr += `${lastVal}${")".repeat(clauses.length + 1)}`;

    return `stereotools=mpan='${expr}'`;
  }

  if (target === "lowpassCutoff") {
    if (sorted.length === 1) {
      return `lowpass=f=${Math.round(sorted[0].value)}`;
    }

    const clauses: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i];
      const p1 = sorted[i + 1];
      const t0 = p0.timeSec.toFixed(3);
      const t1 = p1.timeSec.toFixed(3);
      const dt = (p1.timeSec - p0.timeSec).toFixed(3);
      const df = (p1.value - p0.value).toFixed(1);

      clauses.push(`if(between(t,${t0},${t1}),${p0.value.toFixed(1)}+(${df})*(t-${t0})/${dt},`);
    }

    const firstVal = sorted[0].value.toFixed(1);
    const lastVal = sorted[sorted.length - 1].value.toFixed(1);
    const tFirst = sorted[0].timeSec.toFixed(3);

    let expr = `if(lt(t,${tFirst}),${firstVal},`;
    expr += clauses.join("");
    expr += `${lastVal}${")".repeat(clauses.length + 1)}`;

    return `lowpass=f='${expr}'`;
  }

  return null;
}
