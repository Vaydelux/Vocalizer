import { describe, expect, it } from "bun:test";
import { decodeFile, probeMetadata } from "../../src/lib/studio/decode";
import { MAX_DECODE_BYTES } from "../../src/lib/studio/decode-budget";

/** No browser or audio codec is required for the memory safety preflight. */
describe("browser audio decode preflight", () => {
  it("rejects files beyond the compressed-input cap before reading any bytes", async () => {
    let reads = 0;
    const huge = {
      name: "huge.wav",
      size: MAX_DECODE_BYTES + 1,
      arrayBuffer: async () => { reads++; throw new Error("must not read"); },
    } as unknown as File;
    await expect(decodeFile(huge)).rejects.toHaveProperty("code", "FILE_TOO_LARGE");
    expect(reads).toBe(0);
  });

  it("returns duration-only metadata for hours-long compressed audio without full decode", async () => {
    const win = Object.getOwnPropertyDescriptor(globalThis, "window");
    const doc = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let reads = 0;
    let revoked = 0;
    const audio = {
      duration: 3600,
      preload: "",
      onloadedmetadata: null as null | (() => void),
      onerror: null as null | (() => void),
      removeAttribute: (_: string) => {},
      set src(_: string) {
        queueMicrotask(() => audio.onloadedmetadata?.());
      },
    };
    try {
      Object.defineProperty(globalThis, "window", {
        value: { setTimeout, clearTimeout }, configurable: true,
      });
      Object.defineProperty(globalThis, "document", {
        value: { createElement: () => audio }, configurable: true,
      });
      URL.createObjectURL = () => "blob:memory-budget-fixture";
      URL.revokeObjectURL = () => { revoked++; };

      const smallCompressed = {
        name: "small-compressed-long-song.mp3",
        size: 2 * 1024 * 1024,
        arrayBuffer: async () => { reads++; throw new Error("must not read"); },
      } as unknown as File;
      const result = await probeMetadata(smallCompressed);
      expect(result.duration).toBe(3600);
      expect(result.metaSource).toBe("element");
      expect(result.sampleRate).toBeNull();
      await expect(decodeFile(smallCompressed)).rejects.toHaveProperty("code", "FILE_TOO_LARGE");
      expect(reads).toBe(0);
      expect(revoked).toBe(2);
    } finally {
      if (win) Object.defineProperty(globalThis, "window", win);
      else Reflect.deleteProperty(globalThis, "window");
      if (doc) Object.defineProperty(globalThis, "document", doc);
      else Reflect.deleteProperty(globalThis, "document");
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
