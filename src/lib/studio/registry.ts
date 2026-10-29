/**
 * Model registry — pure resolution, fallback-decision, and accounting logic.
 *
 * This module is deliberately framework-agnostic and side-effect free so the
 * fallback decision logic is independently verifiable. It consumes the typed
 * adapter contracts from `adapters.ts` and the validated manifest type.
 *
 * No inference is performed. A "ready" resolution is only ever returned when an
 * adapter reports `isRuntimeAvailable() === true`, which never happens in this
 * build — so callers always receive an honest unavailable/no-compatible-model
 * result until a verified runtime ships.
 */

import { getAdapter, INFERENCE_ADAPTERS } from "./adapters";
import type {
  BuiltinModelRecord,
  ModelArchitecture,
  ModelFormat,
  ModelOperation,
  ModelResolution,
  ModelResolutionRequest,
  ModelStem,
  ModelRuntime,
  UserModelRecord,
  ValidatedModelManifest,
} from "./types";

/** Identify a plausible architecture from a file format (recognition only). */
export function identifyArchitecture(format: ModelFormat | null): ModelArchitecture | null {
  if (!format) return null;
  switch (format) {
    case ".onnx":
      return "mdx-net"; // most common; manifest is authoritative, not this hint
    case ".safetensors":
      return "custom-safetensors";
    case ".ckpt":
    case ".pth":
    case ".pt":
      return "demucs";
    default:
      return null;
  }
}

export function detectFormat(fileName: string): ModelFormat | null {
  const lower = fileName.toLowerCase();
  const match = lower.match(/(\.(onnx|pth|pt|ckpt|safetensors))$/);
  return (match?.[1] as ModelFormat | undefined) ?? null;
}

/** Recognized supporting-config extensions (never treated as executable weights). */
export const CONFIG_EXTENSIONS = [".yaml", ".yml", ".json"] as const;

export function isConfigFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return CONFIG_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Adapters whose declared architectures/formats match a given file. */
export function adaptersForFile(format: ModelFormat | null): string[] {
  if (!format) return [];
  return INFERENCE_ADAPTERS.filter((a) => a.supportedFormats.includes(format)).map((a) => a.id);
}

export interface RegistrySnapshot {
  builtin: BuiltinModelRecord;
  userModels: UserModelRecord[];
}

/**
 * Resolve a model for an operation following the planned fallback order:
 *  1. Resolve operation + required stems.
 *  2. Validate preferred model availability.
 *  3. Validate the associated adapter.
 *  4. Validate runtime + device compatibility.
 *  5. Attempt preferred.
 *  6. (future) CPU fallback.
 *  7. Bundled default only if compatible with the requested operation + stems.
 *  8. Notify on change. 9. Retry limits. 10. Fail honestly.
 *
 * Because no adapter reports a runtime available in this build, the resolver
 * never returns `ready` — it returns the most specific unavailable reason.
 */
export async function resolveModelForOperation(
  registry: RegistrySnapshot,
  request: ModelResolutionRequest
): Promise<ModelResolution> {
  const requiredStems: ModelStem[] = request.requiredStems;

  // Step 2: preferred model availability.
  const preferredId = request.preferredModelId;
  let preferredView: UserModelRecord | null = null;
  if (preferredId && preferredId !== registry.builtin.id) {
    preferredView = registry.userModels.find((m) => m.manifest.modelId === preferredId) ?? null;
  }
  const preferredIsBuiltin = preferredId === registry.builtin.id;

  if (!preferredId) {
    return {
      status: "no-preferred",
      reason: "No preferred model is selected. Choose a compatible model when AI processing support is enabled.",
    };
  }

  // Determine the candidate manifest + adapter.
  let manifest: ValidatedModelManifest | null = null;
  let candidateId = preferredId;
  let candidateIsBuiltin = false;
  if (preferredIsBuiltin) {
    if (registry.builtin.status !== "installed") {
      return {
        status: "preferred-incompatible",
        modelId: registry.builtin.id,
        reason: "The built-in model is not installed in this phase. Audio separation is not available yet.",
      };
    }
    // Build a synthetic manifest view from the builtin record (no real weights in this build).
    manifest = synthBuiltinManifest(registry.builtin);
    candidateIsBuiltin = true;
  } else if (preferredView) {
    manifest = preferredView.manifest;
  } else {
    return {
      status: "preferred-incompatible",
      modelId: preferredId,
      reason: "The preferred model is not registered in this build.",
    };
  }

  const adapter = getAdapter(manifest.adapterId);
  if (!adapter) {
    return {
      status: "preferred-incompatible",
      modelId: candidateId,
      reason: `No adapter is registered for adapterId "${manifest.adapterId}".`,
    };
  }

  // Step 2b: operation + stems coverage.
  const coversStems = requiredStems.every((s) => manifest!.supportedStems.includes(s));
  if (!coversStems) {
    return {
      status: "preferred-incompatible",
      modelId: candidateId,
      reason: `The preferred model does not declare all requested stems (${requiredStems.join(", ")}). It is not silently substituted with a different stem set.`,
    };
  }

  // Step 3-4: adapter validation (includes runtime availability + device).
  const validation = await adapter.validateModel(manifest);
  if (!validation.ok) {
    if (validation.reason === "runtime-unavailable") {
      return {
        status: "runtime-unavailable",
        modelId: candidateId,
        adapterId: adapter.id,
        reason: candidateIsBuiltin
          ? "The bundled default model's runtime is not available in this build."
          : `Runtime for "${manifest.requiredRuntime}" is not bundled. Inference stays unavailable.`,
      };
    }
    return {
      status: "preferred-incompatible",
      modelId: candidateId,
      reason: validation.detail,
    };
  }

  // Device compatibility check.
  if (request.device && !manifest.supportedDevices.includes(request.device)) {
    return {
      status: "device-incompatible",
      modelId: candidateId,
      reason: `The model does not support device "${request.device}".`,
    };
  }

  // Step 6: CPU fallback — only attempted when the requested device failed AND
  // the model declares CPU. In this build the runtime is never available, so
  // this path still resolves to runtime-unavailable (honest).
  if (request.device !== "cpu" && manifest.supportedDevices.includes("cpu")) {
    const cpuValidation = await adapter.validateModel(manifest);
    if (!cpuValidation.ok && cpuValidation.reason === "runtime-unavailable") {
      return {
        status: "runtime-unavailable",
        modelId: candidateId,
        adapterId: adapter.id,
        reason: `Requested device "${request.device}" is unsupported; CPU fallback attempted but the runtime is not bundled either.`,
      };
    }
  }

  // Step 7: bundled default fallback — only if compatible with the operation.
  if (!candidateIsBuiltin && registry.builtin.status === "installed") {
    const builtinManifest = synthBuiltinManifest(registry.builtin);
    if (coversStemsFor(builtinManifest, requiredStems)) {
      const builtinAdapter = getAdapter(builtinManifest.adapterId);
      if (builtinAdapter) {
        const bv = await builtinAdapter.validateModel(builtinManifest);
        if (bv.ok) {
          return {
            status: "ready",
            modelId: builtinManifest.modelId,
            adapterId: builtinAdapter.id,
            runtime: builtinManifest.requiredRuntime,
            device: "cpu",
            fallbackUsed: true,
            note: "Preferred model unavailable; fell back to the bundled default.",
          };
        }
      }
    }
    return {
      status: "fallback-unavailable",
      reason: "The preferred model cannot run and the bundled default is not compatible with the requested operation. No silent substitution was performed.",
    };
  }

  // A truly ready resolution requires a real runtime — never reached in this build.
  return {
    status: "runtime-unavailable",
    modelId: candidateId,
    adapterId: adapter.id,
    reason: "No verified inference runtime is bundled. Inference is not available in this build.",
  };
}

function coversStemsFor(manifest: ValidatedModelManifest, stems: ModelStem[]): boolean {
  return stems.every((s) => manifest.supportedStems.includes(s));
}

function synthBuiltinManifest(b: BuiltinModelRecord): ValidatedModelManifest {
  return {
    schemaVersion: 1,
    modelId: b.id,
    displayName: b.name,
    modelVersion: "reserved",
    architecture: b.architecture,
    format: b.format,
    adapterId: b.adapterId,
    requiredRuntime: "onnxruntime-cpu" as ModelRuntime,
    origin: "bundled",
    supportedStems: b.supportedStems,
    supportedDevices: ["cpu", "cuda", "directml"],
    files: [{ path: "default/model.onnx", sha256: undefined, sizeBytes: b.sizeBytes }],
    provenance: "Reserved bundled default — not yet shipped.",
    license: "To be verified before bundling.",
  };
}

/** Adapters compatible with a given architecture (for the catalog / inspection UI). */
export function adaptersForArchitecture(arch: ModelArchitecture): string[] {
  return INFERENCE_ADAPTERS.filter((a) => a.supportedArchitectures.includes(arch)).map((a) => a.id);
}

/** Real disk usage of registered models — sums declared file sizes (0 when none declared). */
export function calculateDiskUsage(models: { manifest: ValidatedModelManifest }[]): number {
  return models.reduce(
    (total, m) => total + m.manifest.files.reduce((s, f) => s + (f.sizeBytes ?? 0), 0),
    0
  );
}

/** Compatible (operation, stems) query — for future "retrieve compatible models". */
export function getCompatibleModels(
  registry: RegistrySnapshot,
  _operation: ModelOperation,
  stems: ModelStem[]
): UserModelRecord[] {
  // A model is a candidate when it declares all requested stems AND its
  // adapterId resolves to a registered adapter. Execution eligibility is
  // still decided by `resolveModelForOperation` (runtime + device checks).
  return registry.userModels.filter((m) => {
    const adapter = getAdapter(m.manifest.adapterId);
    if (!adapter) return false;
    return stems.every((s) => m.manifest.supportedStems.includes(s));
  });
}
