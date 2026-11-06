import { describe, it, expect } from "bun:test";
import {
  applyNamingPattern,
  batchRecipeSchema,
  DEFAULT_BATCH_RECIPE,
} from "../../src/lib/studio/batch";

describe("batch processing recipe and utilities", () => {
  it("validates the default batch recipe against zod schema", () => {
    const parseResult = batchRecipeSchema.safeParse(DEFAULT_BATCH_RECIPE);
    expect(parseResult.success).toBe(true);
  });

  it("applies naming pattern substitution properly", () => {
    expect(applyNamingPattern("song.wav", "[name]_mastered")).toBe("song_mastered");
    expect(applyNamingPattern("guitar_take_01.flac", "vocalizer_[name]_24bit")).toBe(
      "vocalizer_guitar_take_01_24bit"
    );
    expect(applyNamingPattern("test track.mp3", "[name]_EBUR128")).toBe("test track_EBUR128");
  });

  it("rejects invalid concurrency or bitrate values", () => {
    const invalidConcurrency = {
      ...DEFAULT_BATCH_RECIPE,
      concurrency: 16, // max is 4
    };
    expect(batchRecipeSchema.safeParse(invalidConcurrency).success).toBe(false);

    const invalidBitrate = {
      ...DEFAULT_BATCH_RECIPE,
      mp3Bitrate: 500, // only 128, 192, 256, 320 allowed
    };
    expect(batchRecipeSchema.safeParse(invalidBitrate).success).toBe(false);
  });
});
