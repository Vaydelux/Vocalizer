import { describe, expect, it } from "bun:test";
import {
  encodeWav,
  encodeWavFromChannels,
  MAX_BROWSER_WAV_BYTES,
} from "../../src/lib/studio/wav";

const signal = () => new AbortController().signal;

function audioBuffer(frames: number, getChannelData: (index: number) => Float32Array): AudioBuffer {
  return {
    length: frames,
    numberOfChannels: 2,
    sampleRate: 48_000,
    getChannelData,
  } as unknown as AudioBuffer;
}

describe("browser WAV export preflight", () => {
  it("writes a valid 16-bit PCM RIFF header for ordinary audio", async () => {
    const left = new Float32Array([0, 1, -1]);
    const right = new Float32Array([0.5, -0.5, 0]);
    const blob = await encodeWav(audioBuffer(3, (index) => index === 0 ? left : right), {
      bitDepth: 16,
      signal: signal(),
    });
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 3 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(blob.size - 8);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });

  it("refuses oversized outputs before accessing audio channel data", async () => {
    const huge = audioBuffer(Math.ceil(MAX_BROWSER_WAV_BYTES / 6), () => {
      throw new Error("Channel data must not be fetched for oversized output");
    });
    await expect(encodeWav(huge, { bitDepth: 24, signal: signal() }))
      .rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects zero samples and unequal raw channel lengths", async () => {
    await expect(encodeWav(audioBuffer(0, () => new Float32Array(0)), {
      bitDepth: 16, signal: signal(),
    })).rejects.toMatchObject({ code: "OUTPUT_EMPTY" });
    await expect(encodeWavFromChannels(
      [new Float32Array(2), new Float32Array(3)], 44_100,
      { bitDepth: 24, signal: signal() },
    )).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("checks raw float-channel output size before allocating and emits valid 24-bit data", async () => {
    const longArray = new Float32Array(1);
    // Only the first array's length is used for the preflight.
    const invalid = new Array(1).fill(longArray);
    await expect(encodeWavFromChannels(invalid, 0, {
      bitDepth: 24, signal: signal(),
    })).rejects.toMatchObject({ code: "INPUT_INVALID" });

    const blob = await encodeWavFromChannels(
      [new Float32Array([-1, 0, 1])], 44_100,
      { bitDepth: 24, signal: signal() },
    );
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(53);
    expect(view.getUint32(40, true)).toBe(9);
    expect(view.getUint16(34, true)).toBe(24);
  });

  it("honors cancellation before allocating output memory", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(encodeWavFromChannels(
      [new Float32Array([0])], 48_000,
      { bitDepth: 16, signal: abort.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
