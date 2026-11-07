import { describe, expect, it } from "bun:test";
import { decodeFile, probeViaElement } from "../../src/lib/studio/decode";

describe("cancellable browser metadata preflight", () => {
  it("releases object URLs immediately on track-change abort and never reads full file", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const nativeSetTimeout = setTimeout;
    const nativeClearTimeout = clearTimeout;
    let revoked = 0;
    let cleared = 0;
    let reads = 0;
    const audio = {
      preload: "",
      onloadedmetadata: null as null | (() => void),
      onerror: null as null | (() => void),
      removeAttribute: (_: string) => {},
      set src(_: string) { /* intentionally never resolves metadata */ },
    };
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          setTimeout: nativeSetTimeout,
          clearTimeout: (id: ReturnType<typeof setTimeout>) => {
            cleared++;
            nativeClearTimeout(id);
          },
        },
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { createElement: () => audio },
      });
      URL.createObjectURL = () => "blob:unfinished-metadata-probe";
      URL.revokeObjectURL = () => { revoked++; };
      const file = {
        name: "switching-track.mp3",
        size: 1024,
        arrayBuffer: async () => {
          reads++;
          return new ArrayBuffer(1024);
        },
      } as unknown as File;
      const controller = new AbortController();
      const pending = decodeFile(file, controller.signal);
      controller.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      expect(reads).toBe(0);
      expect(revoked).toBe(1);
      expect(cleared).toBeGreaterThan(0);
      expect(audio.onloadedmetadata).toBeNull();
      expect(audio.onerror).toBeNull();
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else Reflect.deleteProperty(globalThis, "document");
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("rejects pre-aborted direct metadata probes without creating object URLs", async () => {
    const originalCreate = URL.createObjectURL;
    let called = false;
    try {
      URL.createObjectURL = () => { called = true; throw new Error("must not run"); };
      const controller = new AbortController();
      controller.abort();
      await expect(probeViaElement({ name: "x.wav" } as File, controller.signal))
        .rejects.toHaveProperty("name", "AbortError");
      expect(called).toBe(false);
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });
});
