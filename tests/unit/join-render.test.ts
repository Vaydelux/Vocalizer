import { describe, expect, it } from "bun:test";
import { renderJoin } from "../../src/lib/studio/processing";

describe("Web Audio crossfade scheduling", () => {
  it("starts the incoming clip early and applies matched equal-power fades", async () => {
    const starts: number[] = [];
    const fades: Array<{ start: number; duration: number; values: Float32Array }> = [];
    let outputFrames = 0;

    class TestOfflineAudioContext {
      destination = {};
      constructor(_channels: number, frames: number, _sampleRate: number) {
        outputFrames = frames;
      }
      createBufferSource() {
        return {
          buffer: null as AudioBuffer | null,
          connect: (gain: unknown) => gain,
          start: (at: number) => { starts.push(at); },
        };
      }
      createGain() {
        return {
          gain: {
            value: 1,
            setValueCurveAtTime: (values: Float32Array, start: number, duration: number) => {
              fades.push({ values, start, duration });
            },
          },
          connect: () => this.destination,
        };
      }
      async startRendering(): Promise<AudioBuffer> {
        return { length: outputFrames } as AudioBuffer;
      }
    }

    const original = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = TestOfflineAudioContext as unknown as typeof OfflineAudioContext;
    try {
      const fakeAudio = {
        length: 1000,
        duration: 1,
        sampleRate: 1000,
        numberOfChannels: 1,
      } as AudioBuffer;
      const output = await renderJoin(
        [{ buffer: fakeAudio }, { buffer: fakeAudio }],
        { crossfadeSec: 0.2, targetSampleRate: 1000, targetChannels: 1 },
      );
      expect(output.length).toBe(1800);
      expect(starts).toEqual([0, 0.8]);
      expect(fades).toHaveLength(2);
      expect(fades[0].start).toBeCloseTo(0.8);
      expect(fades[1].start).toBeCloseTo(0.8);
      expect(fades[0].duration).toBeCloseTo(0.2);
      expect(fades[1].duration).toBeCloseTo(0.2);
      expect(fades[0].values[0]).toBeCloseTo(1);
      expect(fades[0].values.at(-1)).toBeCloseTo(0);
      expect(fades[1].values[0]).toBeCloseTo(0);
      expect(fades[1].values.at(-1)).toBeCloseTo(1);
    } finally {
      globalThis.OfflineAudioContext = original;
    }
  });
});
