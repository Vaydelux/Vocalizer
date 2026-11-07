import { describe, expect, it } from "bun:test";
import { MAX_DECODE_BYTES } from "../../src/lib/studio/decode-budget";
import { mayComputeFullWaveform, shouldPreloadMetadataOnly } from "../../src/lib/studio/waveform-policy";

describe("waveform memory policy", () => {
  it("permits moderate browser files with measured safe durations", () => {
    const track = { file: { size: MAX_DECODE_BYTES }, meta: { duration: 180 } };
    expect(mayComputeFullWaveform(track)).toBe(true);
    expect(shouldPreloadMetadataOnly(track)).toBe(false);
  });
  it("never decodes giant files or small compressed songs with excessive PCM duration", () => {
    for (const track of [
      { file: { size: MAX_DECODE_BYTES + 1 }, meta: { duration: 120 } },
      { file: { size: 1024 ** 3 }, meta: { duration: 120 } },
      { file: { size: 2 * 1024 ** 2 }, meta: { duration: 3600 } },
    ]) {
      expect(mayComputeFullWaveform(track)).toBe(false);
      expect(shouldPreloadMetadataOnly(track)).toBe(true);
    }
  });
  it("treats unknown duration, empty files and native-backed sentinels as unsuitable", () => {
    expect(mayComputeFullWaveform({ file: { size: 123 } })).toBe(false);
    expect(mayComputeFullWaveform({ file: { size: 0 }, meta: { duration: 180 } })).toBe(false);
    const native = {
      file: { size: 1 }, meta: { duration: 5 },
      nativeStem: { jobId: "completed", stem: "Vocals" },
    };
    expect(mayComputeFullWaveform(native)).toBe(false);
    expect(shouldPreloadMetadataOnly(native)).toBe(true);
  });
});
