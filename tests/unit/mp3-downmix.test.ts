import { describe, expect, it } from "bun:test";
import { downmixMp3Channels } from "../../src/lib/studio/mp3";

describe("MP3 multichannel downmix", () => {
  it("preserves mono and stereo levels", () => {
    const mono = downmixMp3Channels([new Float32Array([1, -1, 0])]);
    expect(Array.from(mono.left)).toEqual([32767, -32768, 0]);
    expect(mono.right).toBeNull();

    const stereo = downmixMp3Channels([
      new Float32Array([0.5]),
      new Float32Array([-1]),
    ]);
    expect(stereo.left[0]).toBe(16383);
    expect(stereo.right?.[0]).toBe(-32768);
  });

  it("averages secondary channels without wrapping signed 16-bit PCM", () => {
    const output = downmixMp3Channels([
      new Float32Array([1, 0]),
      new Float32Array([1, 1]),
      new Float32Array([1, -1]),
      new Float32Array([1, 0]),
    ]);
    expect(Array.from(output.left)).toEqual([32767, 0]);
    expect(Array.from(output.right!)).toEqual([32767, 0]);
  });

  it("sanitizes nonfinite samples before mixing", () => {
    const output = downmixMp3Channels([
      new Float32Array([Number.NaN, 0]),
      new Float32Array([Number.POSITIVE_INFINITY, 0.5]),
      new Float32Array([1, 0.5]),
    ]);
    expect(Array.from(output.left)).toEqual([0, 0]);
    expect(Array.from(output.right!)).toEqual([16383, 16383]);
  });

  it("rejects empty/mismatched channels and pre-aborted work", () => {
    expect(() => downmixMp3Channels([])).toThrow();
    expect(() => downmixMp3Channels([new Float32Array(1), new Float32Array(2)])).toThrow();
    const abort = new AbortController();
    abort.abort();
    expect(() => downmixMp3Channels([new Float32Array(9000)], abort.signal))
      .toThrow();
  });
});
