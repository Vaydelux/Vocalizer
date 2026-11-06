import { describe, expect, it } from "bun:test";
import {
  MAX_DECODE_BYTES,
  MAX_DECODE_DURATION_SECONDS,
  MAX_PROJECTED_PCM_BYTES,
  projectedBrowserPcmBytes,
  mayDecodeBrowserAudio,
} from "../../src/lib/studio/decode-budget";

describe("browser full decode budget", () => {
  it("permits a normal three-minute stereo recording", () => {
    expect(mayDecodeBrowserAudio(30 * 1024 * 1024, 180)).toBe(true);
    expect(projectedBrowserPcmBytes(180)).toBe(180 * 48_000 * 4 * 4);
  });

  it("blocks a tiny but hours-long compressed file before full PCM allocation", () => {
    expect(mayDecodeBrowserAudio(3 * 1024 * 1024, 3600)).toBe(false);
    expect(mayDecodeBrowserAudio(6 * 1024 * 1024, 500)).toBe(false);
    expect(projectedBrowserPcmBytes(500)).toBeGreaterThan(MAX_PROJECTED_PCM_BYTES);
  });

  it("blocks overly large input and unknown, invalid or infinite durations", () => {
    expect(mayDecodeBrowserAudio(MAX_DECODE_BYTES + 1, 60)).toBe(false);
    expect(mayDecodeBrowserAudio(0, 60)).toBe(false);
    expect(mayDecodeBrowserAudio(Number.NaN, 60)).toBe(false);
    expect(mayDecodeBrowserAudio(1, null)).toBe(false);
    expect(mayDecodeBrowserAudio(1, Number.NaN)).toBe(false);
    expect(mayDecodeBrowserAudio(1, Infinity)).toBe(false);
    expect(mayDecodeBrowserAudio(1, -1)).toBe(false);
    expect(mayDecodeBrowserAudio(1, MAX_DECODE_DURATION_SECONDS + 1)).toBe(false);
  });

  it("enforces bounded estimated PCM even when the compressed size is small", () => {
    const threshold = MAX_PROJECTED_PCM_BYTES / (48_000 * 4 * 4);
    expect(mayDecodeBrowserAudio(1_000_000, threshold - 0.01)).toBe(true);
    expect(mayDecodeBrowserAudio(1_000_000, threshold + 0.01)).toBe(false);
  });
});
