import { describe, expect, it } from "bun:test";
import { parsePublishedStemFilename, doesRelinkedStemMatch } from "../../electron/shared/published-stem";

describe("published-stem recovery safety", () => {
  it("parses the real named outputs of every supported stem", () => {
    for (const stem of ["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"] as const) {
      expect(parsePublishedStemFilename(`Vocalizer-job_123-${stem.toLowerCase()}.flac`)).toEqual({
        jobId: "job_123", stem,
      });
    }
    expect(parsePublishedStemFilename("Vocalizer-long-hyphen-job-12-drums.wav")).toEqual({
      jobId: "long-hyphen-job-12", stem: "Drums",
    });
  });
  it("rejects nonpublished file names and traversal", () => {
    for (const candidate of [
      "../Vocalizer-job-vocals.wav", "C:\\Music\\Vocalizer-job-vocals.wav",
      "Vocalizer-../job-vocals.wav", "Vocalizer-job-vocals.exe",
      "Vocalizer--vocals.wav", "Track-vocals.wav", "Vocalizer-job-vocals.wav/other",
    ]) expect(parsePublishedStemFilename(candidate)).toBeNull();
  });
  it("requires exact basename and bytes, allowing only bounded duration tolerance", () => {
    const expected = { name: "Vocalizer-job-bass.wav", size: 900_000_000, duration: 1800 };
    expect(doesRelinkedStemMatch(expected, { ...expected, duration: 1800.2 })).toBe(true);
    expect(doesRelinkedStemMatch(expected, { ...expected, size: expected.size + 1 })).toBe(false);
    expect(doesRelinkedStemMatch(expected, { ...expected, duration: 1900 })).toBe(false);
    expect(doesRelinkedStemMatch(expected, { ...expected, name: "Vocalizer-other-bass.wav" })).toBe(false);
  });
});
