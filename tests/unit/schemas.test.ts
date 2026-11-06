import { describe, it, expect } from "bun:test";
import { validateSettingsJson, validateModelManifest } from "../../src/lib/studio/schemas";

describe("runtime schema validation", () => {
  it("validates valid settings successfully", () => {
    const valid = {
      theme: "dark",
      accent: "violet",
      exportFormat: "wav16",
      mp3Bitrate: 192,
      sampleRate: "auto",
      concurrency: 1,
      volume: 0.8,
      preferredModelId: null,
      fallbackPolicy: "cpu-then-embedded",
    };
    const result = validateSettingsJson(valid);
    expect(result).not.toBeNull();
    expect(result?.theme).toBe("dark");
  });

  it("rejects corrupt or out-of-range settings", () => {
    expect(validateSettingsJson(null)).toBeNull();
    expect(validateSettingsJson({ theme: "neon-pink" })).toBeNull();
    expect(validateSettingsJson({ volume: 5.0 })).toBeNull(); // volume must be <= 1
  });

  it("validates a well-formed model manifest JSON string", () => {
    const manifest = {
      schemaVersion: 1,
      modelId: "test-mdx-model",
      displayName: "Test MDX Separation",
      modelVersion: "1.0.0",
      architecture: "mdx-net",
      format: ".onnx",
      adapterId: "mdx-net-onnx",
      requiredRuntime: "onnxruntime-cpu",
      origin: "user-imported",
      license: "MIT",
      files: [{ path: "model.onnx", sha256: "a".repeat(64), sizeBytes: 1024 }],
      supportedStems: ["Vocals", "Instrumental"],
      supportedDevices: ["cpu"],
    };
    const result = validateModelManifest(JSON.stringify(manifest));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.modelId).toBe("test-mdx-model");
  });

  it("rejects invalid model manifest with detailed issue report", () => {
    const invalidManifest = {
      modelId: "bad-model",
      // missing required fields
    };
    const result = validateModelManifest(JSON.stringify(invalidManifest));
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
