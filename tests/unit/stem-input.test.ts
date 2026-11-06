import { describe, expect, it } from "bun:test";
import { nativeStemInput, parseNativeStemInput, nativeStemPlaybackUrl, parseNativeStemPlaybackPath } from "../../electron/shared/stem-input";

describe("verified stem input references", () => {
  it("creates stable safe aliases without leaking the user's disk path", () => {
    const ref = { jobId: "j_123-safe", stem: "Vocals" as const };
    expect(nativeStemInput(ref)).toBe("vocalizer-stem:j_123-safe:Vocals");
    expect(parseNativeStemInput(nativeStemInput(ref))).toEqual(ref);
    expect(nativeStemPlaybackUrl(ref)).toBe("las://renderer/__stem-audio/j_123-safe/Vocals");
  });

  it("does not reinterpret a normal source file as a stem token", () => {
    expect(parseNativeStemInput("C:\\\\Music\\\\vocalizer-stem.wav")).toBeNull();
    expect(parseNativeStemInput("/audio/music.wav")).toBeNull();
  });

  it("rejects malformed or unauthorized stem names and traversals", () => {
    const invalid = [
      "vocalizer-stem:../secret:Vocals",
      "vocalizer-stem:abc:NotAStem",
      "vocalizer-stem:abc:Vocals:Other",
      "vocalizer-stem::Vocals",
      "vocalizer-stem:abc:..",
    ];
    for (const input of invalid) expect(() => parseNativeStemInput(input)).toThrow();
    expect(() => nativeStemInput({jobId: "../oops", stem:"Vocals"})).toThrow();
  });
  it("routes every supported stem name through identical native playback validation", () => {
    for (const stem of ["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"] as const) {
      const ref = { jobId: "mix_7", stem };
      expect(parseNativeStemPlaybackPath(new URL(nativeStemPlaybackUrl(ref)).pathname.slice(1))).toEqual(ref);
    }
  });

  it("rejects malformed and traversal-containing playback routes", () => {
    for (const pathname of [
      "__stem-audio/../Vocals",
      "__stem-audio/job/Unexpected",
      "__stem-audio/job/Vocals/extra",
      "__stem-audio/job/Vocals:Other",
      "__stem-audio//Vocals",
      "__stem-audio/job%2Fetc/Vocals",
      "index.html",
    ]) {
      expect(parseNativeStemPlaybackPath(pathname)).toBeNull();
    }
  });

});
