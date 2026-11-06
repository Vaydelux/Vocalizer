import { describe, it, expect } from "bun:test";
import {
  sphericalToCartesian,
  calculateWoodworthItdMs,
  computeSurround51Gains,
  buildSpatialAudioFilter,
  DEFAULT_SPATIAL_POSITION,
} from "../../src/lib/studio/spatial-audio";

describe("3D binaural spatial audio & surround engine", () => {
  it("converts spherical coordinates to Web Audio Cartesian 3D coordinates accurately", () => {
    // 1. Center Front (az=0, el=0, d=1): Should point along negative Z axis
    const center = sphericalToCartesian({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 0, elevationDeg: 0, distanceMeters: 1.0 });
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);
    expect(center.z).toBe(-1);

    // 2. Full Right Ear (az=90, el=0, d=2): Should be on positive X axis
    const right = sphericalToCartesian({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 90, elevationDeg: 0, distanceMeters: 2.0 });
    expect(right.x).toBe(2);
    expect(right.y).toBe(0);
    expect(Math.abs(right.z)).toBeLessThan(0.001);

    // 3. Directly Overhead Zenith (az=0, el=90, d=3): Should be on positive Y axis
    const overhead = sphericalToCartesian({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 0, elevationDeg: 90, distanceMeters: 3.0 });
    expect(overhead.x).toBe(0);
    expect(overhead.y).toBe(3);
    expect(Math.abs(overhead.z)).toBeLessThan(0.001);
  });

  it("calculates Woodworth's Interaural Time Difference (ITD) within physiological limits", () => {
    // Dead ahead: 0 ms delay
    expect(calculateWoodworthItdMs(0)).toBe(0);

    // 90 degrees azimuth: human maximum is ~0.65 to 0.67 milliseconds
    const maxItd = calculateWoodworthItdMs(90);
    expect(maxItd).toBeGreaterThan(0.60);
    expect(maxItd).toBeLessThan(0.70);

    // Symmetry: -90 degrees gives identical absolute ITD delay
    expect(calculateWoodworthItdMs(-90)).toBe(maxItd);
  });

  it("distributes discrete 5.1 surround speaker gains with energy preservation", () => {
    // Front center position
    const fcGains = computeSurround51Gains({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 0, distanceMeters: 1.0 });
    expect(fcGains.fc).toBeGreaterThan(fcGains.fl);
    expect(fcGains.fc).toBeGreaterThan(fcGains.fr);
    expect(fcGains.sl).toBe(0);
    expect(fcGains.sr).toBe(0);

    // Hard right position
    const frGains = computeSurround51Gains({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 30, distanceMeters: 1.0 });
    expect(frGains.fr).toBeGreaterThan(frGains.fl);

    // Surround left position
    const slGains = computeSurround51Gains({ ...DEFAULT_SPATIAL_POSITION, azimuthDeg: -110, distanceMeters: 1.0 });
    expect(slGains.sl).toBeGreaterThan(slGains.sr);
    expect(slGains.sl).toBeGreaterThan(slGains.fl);
  });

  it("generates valid FFmpeg filter clauses for both binaural and 5.1 surround", () => {
    // 5.1 surround filter
    const surroundFilters = buildSpatialAudioFilter(
      { ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 45, distanceMeters: 1.0 },
      "surround51"
    );
    expect(surroundFilters.length).toBe(1);
    expect(surroundFilters[0]).toContain("pan=5.1");
    expect(surroundFilters[0]).toContain("c0=");
    expect(surroundFilters[0]).toContain("c5=");

    // Binaural right-panned filter (requires delay and head-shadow equalizer)
    const binauralFilters = buildSpatialAudioFilter(
      { ...DEFAULT_SPATIAL_POSITION, azimuthDeg: 60, distanceMeters: 1.0 },
      "binaural"
    );
    expect(binauralFilters.length).toBeGreaterThan(0);
    expect(binauralFilters.some((f) => f.includes("adelay"))).toBe(true);
    expect(binauralFilters.some((f) => f.includes("equalizer"))).toBe(true);
  });
});
