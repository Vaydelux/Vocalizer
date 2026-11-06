import { describe, expect, it } from "bun:test";
import { nativeStemInput, parseNativeStemInput, nativeStemPlaybackUrl } from "../../electron/shared/stem-input";

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
});
