import { describe, it, expect } from "bun:test";
import {
  evaluateAutomationAtTime,
  compileAutomationToFfmpegFilter,
  type AutomationPoint,
} from "../../src/lib/studio/automation";

describe("timeline automation & dynamic envelopes engine", () => {
  it("evaluates piecewise linear interpolation accurately across timestamps", () => {
    const points: AutomationPoint[] = [
      { id: "p1", timeSec: 2.0, value: 0, curveType: "linear" },
      { id: "p2", timeSec: 6.0, value: 10, curveType: "linear" },
    ];

    // Empty fallback
    expect(evaluateAutomationAtTime([], 5.0, 42)).toBe(42);

    // Clamping before first point (time < 2.0s)
    expect(evaluateAutomationAtTime(points, 0.5, 0)).toBe(0);

    // Midpoint (time = 4.0s): Exactly halfway between 0 and 10 -> 5.0
    expect(evaluateAutomationAtTime(points, 4.0, 0)).toBe(5.0);

    // 75% point (time = 5.0s): 7.5
    expect(evaluateAutomationAtTime(points, 5.0, 0)).toBe(7.5);

    // Clamping after last point (time > 6.0s)
    expect(evaluateAutomationAtTime(points, 10.0, 0)).toBe(10);
  });

  it("evaluates cubic Hermite smooth S-curve and step-hold behaviors", () => {
    // 1. Step-hold mode: keeps initial value until reaching next breakpoint
    const holdPoints: AutomationPoint[] = [
      { id: "h1", timeSec: 1.0, value: 100, curveType: "hold" },
      { id: "h2", timeSec: 5.0, value: 500, curveType: "hold" },
    ];
    expect(evaluateAutomationAtTime(holdPoints, 3.0, 0)).toBe(100);
    expect(evaluateAutomationAtTime(holdPoints, 4.99, 0)).toBe(100);
    expect(evaluateAutomationAtTime(holdPoints, 5.0, 0)).toBe(500);

    // 2. Bezier mode: cubic Hermite smooth S-curve (3t^2 - 2t^3)
    const bezierPoints: AutomationPoint[] = [
      { id: "b1", timeSec: 0.0, value: 0, curveType: "bezier" },
      { id: "b2", timeSec: 1.0, value: 100, curveType: "bezier" },
    ];
    // At t=0.5: 3*(0.25) - 2*(0.125) = 0.75 - 0.25 = 0.50 -> exactly 50
    expect(evaluateAutomationAtTime(bezierPoints, 0.5, 0)).toBe(50);

    // At t=0.25: linear would be 25, S-curve is gentler (3*0.0625 - 2*0.015625 = 0.15625 -> 15.625)
    const valQuarter = evaluateAutomationAtTime(bezierPoints, 0.25, 0);
    expect(valQuarter).toBeLessThan(25);
    expect(valQuarter).toBeGreaterThan(15);
  });

  it("compiles volume automation into valid FFmpeg frame-evaluation filter expressions", () => {
    const volumePoints: AutomationPoint[] = [
      { id: "v1", timeSec: 0.0, value: -6.0, curveType: "linear" },
      { id: "v2", timeSec: 3.0, value: 0.0, curveType: "linear" },
      { id: "v3", timeSec: 5.0, value: -12.0, curveType: "linear" },
    ];

    const filter = compileAutomationToFfmpegFilter("volume", volumePoints);
    expect(filter).not.toBeNull();
    expect(filter).toContain("volume=eval=frame:volume=");
    expect(filter).toContain("between(t,");
    expect(filter).toContain("lt(t,");
  });

  it("compiles stereo pan automation into valid FFmpeg stereotools filter expressions", () => {
    const panPoints: AutomationPoint[] = [
      { id: "pan1", timeSec: 1.0, value: -1.0, curveType: "linear" }, // Hard left
      { id: "pan2", timeSec: 4.0, value: 1.0, curveType: "linear" },  // Hard right
    ];

    const filter = compileAutomationToFfmpegFilter("pan", panPoints);
    expect(filter).not.toBeNull();
    expect(filter).toContain("stereotools=mpan=");
    expect(filter).toContain("between(t,1.000,4.000)");
  });

  it("compiles lowpass cutoff automation into dynamic lowpass filter expressions", () => {
    const cutoffPoints: AutomationPoint[] = [
      { id: "c1", timeSec: 0.0, value: 20000, curveType: "linear" },
      { id: "c2", timeSec: 2.5, value: 800, curveType: "linear" }, // Sweep down
    ];

    const filter = compileAutomationToFfmpegFilter("lowpassCutoff", cutoffPoints);
    expect(filter).not.toBeNull();
    expect(filter).toContain("lowpass=f=");
    expect(filter).toContain("between(t,0.000,2.500)");
  });
});
