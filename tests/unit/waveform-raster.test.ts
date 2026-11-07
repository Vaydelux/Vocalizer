import { describe, expect, it } from "bun:test";
import { planWaveformRaster } from "../../src/lib/studio/waveform-raster";
import { MAX_WAVEFORM_RASTER_PX } from "../../src/lib/studio/waveform-viewport";

describe("layered waveform raster allocation policy", () => {
  it("gives both canvas layers the same raster at normal and high DPI", () => {
    expect(planWaveformRaster(1200, 128, 1)).toEqual({ width: 1200, height: 128, scale: 1 });
    expect(planWaveformRaster(1200, 128, 2)).toEqual({ width: 2400, height: 256, scale: 2 });
    expect(planWaveformRaster(1200, 128, 4)).toEqual({ width: 2400, height: 256, scale: 2 });
  });
  it("caps extremely wide/large bitmaps independently from timeline width", () => {
    const wide = planWaveformRaster(20000, 128, 3);
    expect(wide.width).toBeLessThanOrEqual(MAX_WAVEFORM_RASTER_PX);
    expect(wide.height).toBeLessThanOrEqual(4096);
    const tall = planWaveformRaster(1000, 10000, 2);
    expect(tall.height).toBeLessThanOrEqual(4096);
  });
  it("handles nonfinite dimensions without zero-sized bitmap", () => {
    expect(planWaveformRaster(Number.NaN, 128, Number.NaN)).toEqual({
      width: 1, height: 128, scale: 1,
    });
    const zero = planWaveformRaster(0, 0, 0);
    expect(zero.width).toBeGreaterThan(0);
    expect(zero.height).toBeGreaterThan(0);
    expect(Number.isFinite(zero.scale)).toBe(true);
  });
});
