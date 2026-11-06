import { describe, it, expect } from "bun:test";
import { fftInPlace, mixToMono } from "../../src/lib/studio/analysis";

describe("audio analysis DSP", () => {
  it("computes FFT of an impulse signal", () => {
    const n = 8;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    // Delta function at t=0
    re[0] = 1;

    fftInPlace(re, im);

    // FFT of delta is constant 1 across all bins
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(1, 4);
      expect(im[i]).toBeCloseTo(0, 4);
    }
  });

  it("computes FFT of a pure sine wave at Nyquist", () => {
    const n = 8;
    const re = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
    const im = new Float32Array(n);

    fftInPlace(re, im);

    // Energy should be concentrated at bin n/2 = 4
    expect(re[4]).toBeCloseTo(8, 4);
    expect(re[0]).toBeCloseTo(0, 4);
  });

  it("mixes stereo audio buffer down to mono", () => {
    // Mock AudioBuffer
    const mockBuffer = {
      numberOfChannels: 2,
      getChannelData: (ch: number) => {
        return ch === 0 ? new Float32Array([1, 0.5, -0.5]) : new Float32Array([0.5, 0.5, -0.5]);
      },
    } as unknown as AudioBuffer;

    const mono = mixToMono(mockBuffer, 0, 3);
    expect(mono.length).toBe(3);
    expect(mono[0]).toBeCloseTo(0.75, 4);
    expect(mono[1]).toBeCloseTo(0.5, 4);
    expect(mono[2]).toBeCloseTo(-0.5, 4);
  });
});
