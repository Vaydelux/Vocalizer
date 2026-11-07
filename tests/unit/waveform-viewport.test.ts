import { describe, expect, it } from "bun:test";
import {
  MAX_WAVEFORM_RASTER_PX,
  MAX_WAVEFORM_TIMELINE_PX,
  planWaveformViewport,
  waveformTimeAtPointer,
} from "../../src/lib/studio/waveform-viewport";

describe("virtualized waveform viewport planning", () => {
  it("fits short audio to the visible canvas without overflow", () => {
    const layout = planWaveformViewport(100, 800, 0);
    expect(layout).toEqual({
      viewportWidth: 800,
      timelineWidth: 800,
      pixelsPerSecond: 8,
    });
    expect(waveformTimeAtPointer(400, 0, 100, layout)).toBe(50);
  });

  it("provides accurate clicks at scrolled positions for a 2-hour song", () => {
    const layout = planWaveformViewport(7200, 1000, 100);
    expect(layout.timelineWidth).toBe(720000);
    // Scroll ~5000 seconds in, then click 20 seconds into the viewport.
    expect(waveformTimeAtPointer(200, 500000, 7200, layout)).toBe(5002);
    expect(waveformTimeAtPointer(200, 0, 7200, layout)).toBe(2);
    expect(layout.viewportWidth).toBe(1000);
  });

  it("caps day-long high zoom without shrinking the visible canvas", () => {
    const duration = 24 * 60 * 60;
    const layout = planWaveformViewport(duration, 1600, 400);
    expect(layout.timelineWidth).toBe(MAX_WAVEFORM_TIMELINE_PX);
    expect(layout.viewportWidth).toBe(1600);
    expect(layout.pixelsPerSecond).toBeCloseTo(MAX_WAVEFORM_TIMELINE_PX / duration);
    expect(waveformTimeAtPointer(400, layout.timelineWidth - 1600, duration, layout)).toBeGreaterThan(duration - 40);
    expect(MAX_WAVEFORM_RASTER_PX).toBeLessThan(MAX_WAVEFORM_TIMELINE_PX);
  });

  it("clamps pointer mapping and handles missing metadata safely", () => {
    const layout = planWaveformViewport(100, 800, 0);
    expect(waveformTimeAtPointer(-400, 0, 100, layout)).toBe(0);
    expect(waveformTimeAtPointer(300, 900, 100, layout)).toBe(100);
    expect(waveformTimeAtPointer(300, 900, 0, layout)).toBe(0);
    expect(planWaveformViewport(Number.NaN, 800, 0).timelineWidth).toBe(800);
    expect(planWaveformViewport(200, Number.NaN, 0).viewportWidth).toBe(1);
  });

  it("never reports a timeline smaller than the viewport on extreme zoom out", () => {
    const layout = planWaveformViewport(3600, 1200, 0.001);
    expect(layout.timelineWidth).toBe(1200);
    expect(layout.pixelsPerSecond).toBeCloseTo(1200 / 3600);
  });
});
