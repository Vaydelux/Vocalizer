/**
 * Zod runtime schemas — settings persistence and model manifest validation.
 * Used to validate every persisted/untrusted JSON before it is accepted.
 */

import { z } from "zod";

/* --------------------------------- settings -------------------------------- */

export const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]),
  accent: z.enum(["violet", "indigo"]),
  exportFormat: z.enum(["wav16", "wav24"]),
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

export const KNOWN_ADAPTER_IDS = [
  "onnxruntime.mdxnet",
  "onnxruntime.vr-arch",
  "pytorch.demucs",
  "pytorch.bs-roformer",
  "pytorch.melband-roformer",
  "python.mdx-net",
  "generic.onnx",
] as const;

export const KNOWN_RUNTIMES = [
  "onnxruntime-web",
  "onnxruntime-node",
  "onnxruntime-gpu",
  "pytorch-cpu",
  "pytorch-cuda",
  "pytorch-directml",
] as const;

export const modelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  modelId: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "modelId must be alphanumeric with . _ - only"),
  displayName: z.string().min(1).max(160),
  modelVersion: z.string().min(1).max(40),
  architecture: z.string().min(2).max(80),
  format: z.enum([".onnx", ".ckpt", ".pth", ".pt", ".safetensors"]),
  adapterId: z.string().min(3).max(80),
  requiredRuntime: z.string().min(2).max(80),
  requiredFiles: z.array(z.string().min(1)).min(1),
  fileHashes: z.record(z.string().min(1), z.string().min(8)),
  supportedStems: z.array(z.enum(MODEL_STEM_LABELS)).min(1),
  deviceSupport: z.array(z.enum(["cpu", "cuda", "directml", "metal", "webgpu"])).min(1),
  provenance: z.string().max(400),
  license: z.string().min(1).max(200),
  origin: z.enum(["bundled", "user-installed"]),
  sizeBytes: z.number().int().nonnegative(),
});

export type ModelManifestJson = z.infer<typeof modelManifestSchema>;

export interface ManifestValidationOutput {
  ok: boolean;
  manifest?: ModelManifestJson;
  issues: string[];
  /** Adapter/runtime compatibility verdicts (validated, not inferred). */
  compatibility: { adapterKnown: boolean; runtimeKnown: boolean; inferenceImplemented: false };
}

/**
 * Validate an untrusted manifest string. Returns structured issues.
 * `inferenceImplemented` is always false in this build: a valid manifest is
 * registered as metadata only and never enables model execution.
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
  const adapterKnown = (KNOWN_ADAPTER_IDS as readonly string[]).includes(manifest.adapterId);
  const runtimeKnown = (KNOWN_RUNTIMES as readonly string[]).includes(manifest.requiredRuntime);
  if (!adapterKnown) {
    issues.push(
      `Adapter "${manifest.adapterId}" is not in the registered adapter list. Manifest accepted as metadata; inference stays unavailable.`
    );
  }
  if (!runtimeKnown) {
    issues.push(
      `Runtime "${manifest.requiredRuntime}" is not a known runtime in this build.`
    );
  }
  const hashFiles = Object.keys(manifest.fileHashes);
  const missingHashes = manifest.requiredFiles.filter((f) => !hashFiles.includes(f));
  if (missingHashes.length > 0) {
    issues.push(`Missing hashes for required files: ${missingHashes.join(", ")}`);
  }

  return {
    ok: issues.length === 0,
    manifest,
    issues,
    compatibility: { adapterKnown, runtimeKnown, inferenceImplemented: false },
  };
}
