/**
 * Zod runtime schemas — settings persistence and model manifest validation.
 * Used to validate every persisted/untrusted JSON before it is accepted.
 */

import { z } from "zod";

/* --------------------------------- settings -------------------------------- */

export const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]),
  accent: z.enum(["violet", "indigo"]),
  exportFormat: z.enum(["wav16", "wav24", "mp3"]),
  mp3Bitrate: z.union([z.literal(128), z.literal(192), z.literal(256), z.literal(320)]),
  sampleRate: z.union([z.literal("auto"), z.literal(44100), z.literal(48000)]),
  concurrency: z.union([z.literal(1), z.literal(2)]),
  volume: z.number().min(0).max(1),
  preferredModelId: z.string().nullable(),
  fallbackPolicy: z.enum(["cpu-then-embedded", "embedded-only", "error"]),
});

export type SettingsJson = z.infer<typeof settingsSchema>;

export function validateSettingsJson(input: unknown): SettingsJson | null {
  const result = settingsSchema.safeParse(input);
  return result.success ? result.data : null;
}

/* ----------------------------- model manifest ------------------------------ */

export const MODEL_STEM_LABELS = [
  "Vocals",
  "Instrumental",
  "Drums",
  "Bass",
  "Guitar",
  "Piano",
  "Other",
] as const;

export const MODEL_ARCHITECTURES = [
  "mdx-net",
  "demucs",
  "bs-roformer",
  "melband-roformer",
  "vr-arch",
  "generic-onnx",
  "custom-pytorch",
  "custom-safetensors",
] as const;

export const MODEL_FORMATS = [".onnx", ".pth", ".pt", ".ckpt", ".safetensors"] as const;

export const MODEL_RUNTIMES = [
  "onnxruntime-cpu",
  "onnxruntime-cuda",
  "onnxruntime-directml",
  "pytorch-cpu",
  "pytorch-cuda",
  "pytorch-directml",
  "pytorch-mps",
] as const;

export const MODEL_DEVICES = ["cpu", "cuda", "directml", "mps"] as const;

/**
 * Relative-path validator — rejects traversal, absolute paths, Windows drive
 * letters, and shell metacharacters. Model files must live inside the model
 * storage directory; no escapes are permitted.
 */
const SAFE_RELATIVE_PATH = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\\/:*?"<>|\x00-\x1f]+$/, "Path contains forbidden characters")
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\"), "Absolute paths are forbidden")
  .refine((p) => !/^[A-Za-z]:/.test(p), "Windows drive paths are forbidden")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "Path traversal (..) is forbidden");

const SHA256 = z.string().regex(/^[a-fA-F0-9]{64}$/, "Expected a 64-character hex SHA-256");

/**
 * Strict manifest schema: unknown keys are rejected (so manifests cannot sneak
 * in `command`, `script`, `exec`, or other executable directives). Every field
 * is enumerated — no free-form architecture/runtime strings.
 */
export const modelManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelId: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, "modelId must be alphanumeric with . _ - only"),
    displayName: z.string().min(1).max(160),
    modelVersion: z.string().min(1).max(40),
    architecture: z.enum(MODEL_ARCHITECTURES),
    format: z.enum(MODEL_FORMATS),
    adapterId: z.string().min(3).max(80),
    requiredRuntime: z.enum(MODEL_RUNTIMES),
    origin: z.enum(["bundled", "user-imported"]),
    supportedStems: z.array(z.enum(MODEL_STEM_LABELS)).min(1),
    supportedDevices: z.array(z.enum(MODEL_DEVICES)).min(1),
    files: z
      .array(
        z.object({
          path: SAFE_RELATIVE_PATH,
          sha256: SHA256.optional(),
          sizeBytes: z.number().int().nonnegative().optional(),
        })
      )
      .min(1),
    provenance: z.string().max(400).optional(),
    license: z.string().min(1).max(200),
  })
  .strict();

export type ModelManifestJson = z.infer<typeof modelManifestSchema>;

export interface ManifestValidationOutput {
  ok: boolean;
  manifest?: ModelManifestJson;
  issues: string[];
  /** Adapter/runtime compatibility verdicts (validated, not inferred). */
  compatibility: { adapterKnown: boolean; runtimeKnown: boolean; inferenceImplemented: false };
}

/** Forbidden top-level keys that would never be honored even if present. */
const FORBIDDEN_KEYS = new Set([
  "command",
  "script",
  "exec",
  "preExec",
  "postExec",
  "onLoad",
  "entrypoint",
  "main",
  "shellCommand",
]);

/**
 * Validate an untrusted manifest string. Rejects malformed JSON, unknown keys
 * (including executable directives), unsafe file paths, and bad checksums.
 * `inferenceImplemented` is always false: a valid manifest registers metadata
 * only and never enables model execution.
 */
export function validateModelManifest(raw: string): ManifestValidationOutput {
  const issues: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      issues: [`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
      compatibility: { adapterKnown: false, runtimeKnown: false, inferenceImplemented: false },
    };
  }

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const keys = Object.keys(json as Record<string, unknown>);
    const forbidden = keys.filter((k) => FORBIDDEN_KEYS.has(k));
    if (forbidden.length > 0) {
      issues.push(
        `Manifest declares forbidden executable key(s): ${forbidden.join(", ")}. Manifests may not specify commands, scripts, or entry points.`
      );
    }
  }

  const parsed = modelManifestSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "(root)";
      issues.push(`${path}: ${issue.message}`);
    }
    return {
      ok: false,
      issues: issues.slice(0, 20),
      compatibility: { adapterKnown: false, runtimeKnown: false, inferenceImplemented: false },
    };
  }

  const manifest = parsed.data;
  // Architecture ↔ format consistency (recognized ≠ executable, but mismatches are flagged).
  const archFormatOk = ARCH_FORMAT_COMPATIBLE[manifest.architecture]?.has(manifest.format) ?? false;
  if (!archFormatOk) {
    issues.push(
      `Architecture "${manifest.architecture}" is not associated with format "${manifest.format}".`
    );
  }
  // Runtime ↔ architecture family consistency.
  const runtimeFamilyOk = RUNTIME_FAMILY_COMPATIBLE[manifest.requiredRuntime]?.has(manifest.architecture) ?? false;
  if (!runtimeFamilyOk) {
    issues.push(
      `Runtime "${manifest.requiredRuntime}" is not a typical match for architecture "${manifest.architecture}".`
    );
  }
  // Duplicate file paths are invalid.
  const paths = manifest.files.map((f) => f.path);
  if (new Set(paths).size !== paths.length) {
    issues.push("Duplicate file paths are not allowed in a manifest.");
  }

  return {
    ok: issues.length === 0,
    manifest,
    issues,
    compatibility: {
      adapterKnown: true, // architecture + format + runtime are all enumerated/known
      runtimeKnown: true,
      inferenceImplemented: false,
    },
  };
}

/** Which formats are plausible for each architecture (recognition, not execution). */
const ARCH_FORMAT_COMPATIBLE: Record<string, Set<string>> = {
  "mdx-net": new Set([".onnx"]),
  "vr-arch": new Set([".onnx"]),
  "generic-onnx": new Set([".onnx"]),
  demucs: new Set([".ckpt", ".pth", ".pt", ".safetensors"]),
  "bs-roformer": new Set([".ckpt", ".safetensors"]),
  "melband-roformer": new Set([".ckpt", ".safetensors"]),
  "custom-pytorch": new Set([".ckpt", ".pth", ".pt", ".safetensors"]),
  "custom-safetensors": new Set([".safetensors"]),
};

const RUNTIME_FAMILY_COMPATIBLE: Record<string, Set<string>> = {
  "onnxruntime-cpu": new Set(["mdx-net", "vr-arch", "generic-onnx"]),
  "onnxruntime-cuda": new Set(["mdx-net", "vr-arch", "generic-onnx"]),
  "onnxruntime-directml": new Set(["mdx-net", "vr-arch", "generic-onnx"]),
  "pytorch-cpu": new Set(["demucs", "bs-roformer", "melband-roformer", "custom-pytorch", "custom-safetensors"]),
  "pytorch-cuda": new Set(["demucs", "bs-roformer", "melband-roformer", "custom-pytorch", "custom-safetensors"]),
  "pytorch-directml": new Set(["demucs", "bs-roformer", "melband-roformer", "custom-pytorch", "custom-safetensors"]),
  "pytorch-mps": new Set(["demucs", "bs-roformer", "melband-roformer", "custom-pytorch", "custom-safetensors"]),
};
