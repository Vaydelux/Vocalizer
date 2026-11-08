import { describe, expect, it } from "bun:test";
import {
  NativePeakCollector, aggregatePeakLevel, chooseNativePeakLevel,
  NATIVE_PEAK_BASE_FPS,
} from "../../electron/shared/native-waveform";

const pcm = (samples: number[]) => {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((x, i) => buffer.writeFloatLE(x, i * 4));
  return buffer;
};

describe("streaming native waveform envelopes", () => {
  it("covers first, last and negative samples even when PCM frames split across chunks", () => {
    const raw = new Array(400).fill(0);
    raw[0] = -0.8;
    raw[50] = 0.7;
    raw[399] = -0.9;
    const data = pcm(raw);
    const collector = new NativePeakCollector(0.05);
    collector.write(data.subarray(0, 7)); // intentionally split a float32
    collector.write(data.subarray(7, 129));
    collector.write(data.subarray(129));
    const result = collector.finish();
    expect(result.levels.map(level => level.fps)).toEqual([40, 10, 2]);
    expect(result.levels[0].buckets).toBe(2);
    expect(result.levels[0].minMax[0]).toBeCloseTo(-0.8);
    expect(result.levels[0].minMax[1]).toBeCloseTo(0.7);
    expect(result.levels[0].minMax[2]).toBeCloseTo(-0.9);
    expect(result.levels[1].minMax[0]).toBeCloseTo(-0.9);
    expect(result.levels[2].minMax[1]).toBeCloseTo(0.7);
  });

  it("selects overview density for fit view and high density for close zoom", () => {
    const collector = new NativePeakCollector(0.025);
    collector.write(pcm(new Array(200).fill(0.4)));
    const levels = collector.finish().levels;
    expect(chooseNativePeakLevel(levels, 1).fps).toBe(2);
    expect(chooseNativePeakLevel(levels, 8).fps).toBe(10);
    expect(chooseNativePeakLevel(levels, 35).fps).toBe(NATIVE_PEAK_BASE_FPS);
    expect(chooseNativePeakLevel(levels, 100).fps).toBe(40);
    expect(chooseNativePeakLevel(levels, Number.NaN).fps).toBe(2);
  });

  it("aggregates partial terminal buckets without dropping last amplitudes", () => {
    const high = {
      fps: 40, buckets: 5,
      minMax: Float32Array.from([-0.1, 0.2, -0.3, 0.4, -0.6, 0.8, -0.2, 0.5, -0.9, 0.2]),
    };
    const low = aggregatePeakLevel(high, 10);
    expect(low.buckets).toBe(2);
    expect(low.minMax[0]).toBeCloseTo(-0.6);
    expect(low.minMax[1]).toBeCloseTo(0.8);
    expect(low.minMax[2]).toBeCloseTo(-0.9);
    expect(low.minMax[3]).toBeCloseTo(0.2);
  });

  it("rejects unbounded durations and malformed PCM streams", () => {
    expect(() => new NativePeakCollector(0)).toThrow();
    expect(() => new NativePeakCollector(4 * 3600 + 1)).toThrow();
    const noAudio = new NativePeakCollector(10);
    expect(() => noAudio.finish()).toThrow();
    noAudio.write(Buffer.from([0, 0, 0]));
    expect(() => noAudio.finish()).toThrow();
    const tooLong = new NativePeakCollector(0.01);
    expect(() => tooLong.write(pcm(new Array(5 * 8000).fill(0)))).toThrow();
  });
});
