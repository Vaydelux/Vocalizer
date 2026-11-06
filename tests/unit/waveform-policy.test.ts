import { describe, expect, it } from "bun:test";
import { MAX_DECODE_BYTES } from "../../src/lib/studio/decode";
import { mayComputeFullWaveform, shouldPreloadMetadataOnly } from "../../src/lib/studio/waveform-policy";

describe("waveform memory policy", () => {
  it("permits bounded browser files to generate a waveform", () => {
    const track = { file: { size: MAX_DECODE_BYTES } };
    expect(mayComputeFullWaveform(track)).toBe(true);
    expect(shouldPreloadMetadataOnly(track)).toBe(false);
  });
  it("does not decode a 1 GiB WAV or any source exceeding the threshold", () => {
    for (const size of [MAX_DECODE_BYTES + 1, 1024 ** 3]) {
      const track = { file: { size } };
      expect(mayComputeFullWaveform(track)).toBe(false);
      expect(shouldPreloadMetadataOnly(track)).toBe(true);
    }
  });
  it("does not decode zero-byte or native-backed sentinels", () => {
    expect(mayComputeFullWaveform({ file: { size: 0 } })).toBe(false);
    const native = { file: { size: 1 }, nativeStem: { jobId: "completed", stem: "Vocals" } };
    expect(mayComputeFullWaveform(native)).toBe(false);
    expect(shouldPreloadMetadataOnly(native)).toBe(true);
  });
});
