"use client";

/**
 * Model registry store — central, persisted-as-metadata registry.
 *
 * - Built-in protected fallback slot (reserved, not installed in this phase).
 * - User-registered manifests: validated metadata only, never executable.
 * - Local file inspection results (SHA-256, format, adapter compatibility).
 * - Fallback resolution via the pure `resolveModelForOperation` resolver.
 *
 * Inference is NEVER enabled in this build. A valid manifest + recognized
 * adapter only registers metadata; the resolver always reports runtime-
 * unavailable because no adapter reports a bundled runtime.
 */

import { create } from "zustand";
import { ADAPTER_RECORDS, getAdapter, INFERENCE_ADAPTERS } from "./adapters";
import { validateModelManifest } from "./schemas";
import { resolveModelForOperation } from "./registry";
import { calculateDiskUsage } from "./registry";
import { webPreviewStorageUsage } from "./storage";
import { inspectModelFiles } from "./inspect";
import type {
  AdapterRecord,
  BuiltinModelRecord,
  ModelInspectionResult,
  ModelManifestValidation,
  ModelOperation,
  ModelResolution,
  ModelResolutionRequest,
  ModelStem,
  UserModelRecord,
  ValidatedModelManifest,
} from "./types";
import type { StorageUsage } from "./storage";

export const BUILTIN_MODEL: BuiltinModelRecord = {
  id: "builtin.mdxnet-vocals.onnx.v1",
  name: "Built-in vocal/instrumental model (reserved slot)",
  architecture: "mdx-net",
  format: ".onnx",
  adapterId: "onnxruntime.mdxnet",
  supportedStems: ["Vocals", "Instrumental"],
  status: "not-installed",
  protectedBundledResource: true,
  sizeBytes: 0,
  note:
    "A verified MDX-Net-compatible ONNX model will be bundled with application resources in a later phase (checksum-protected, offline, non-removable). Until then this slot reports unavailable and the separation fallback is not ready.",
};

interface ModelsStore {
  adapters: AdapterRecord[];
  builtin: BuiltinModelRecord;
  userModels: UserModelRecord[];
  validations: ModelManifestValidation[];
  inspections: ModelInspectionResult[];
  /** Validate a manifest string and register it as metadata if valid. */
  validateAndRegister: (raw: string) => ModelManifestValidation;
  /** Inspect local model files without enabling inference. */
  inspectFiles: (primary: File, associated?: File[]) => Promise<ModelInspectionResult>;
  /** Register an inspected file as a metadata-only model (no inference). */
  registerInspection: (inspection: ModelInspectionResult, manifest: ValidatedModelManifest) => { ok: boolean; reason?: string };
  removeUserModel: (modelId: string) => { ok: boolean; reason?: string };
  clearInspections: () => void;
  /** Resolve a model for an operation (fallback order). Always unavailable in this build. */
  resolveFor: (request: ModelResolutionRequest) => Promise<ModelResolution>;
  /** True availability of a model id for an operation+stems (never true in this build). */
  isModelUsableFor: (modelId: string | null, operation: ModelOperation, stems: ModelStem[]) => Promise<{ usable: boolean; reason: string }>;
  /** Storage usage report (web preview: honest N/A for paths, real counts). */
  storageUsage: () => StorageUsage;
}

export const useModels = create<ModelsStore>((set, get) => ({
  adapters: ADAPTER_RECORDS,
  builtin: BUILTIN_MODEL,
  userModels: [],
  validations: [],
  inspections: [],

  validateAndRegister: (raw) => {
    const validated = validateModelManifest(raw);
    const result: ModelManifestValidation = validated.ok
      ? { ok: true, manifest: validated.manifest as ValidatedModelManifest, validatedAt: Date.now() }
      : { ok: false, issues: validated.issues, validatedAt: Date.now() };
    set((s) => ({
      validations: [result, ...s.validations].slice(0, 20),
      // Only fully valid manifests get registered as metadata. Inference stays
      // unavailable regardless — a valid manifest never enables execution.
      userModels:
        result.ok
          ? [
              ...s.userModels.filter((m) => m.manifest.modelId !== result.manifest!.modelId),
              { manifest: result.manifest!, registeredAt: Date.now(), inferenceReady: false },
            ]
          : s.userModels,
    }));
    return result;
  },

  inspectFiles: async (primary, associated = []) => {
    const result = await inspectModelFiles(primary, associated);
    set((s) => ({ inspections: [result, ...s.inspections].slice(0, 12) }));
    return result;
  },

  registerInspection: (inspection, manifest) => {
    // Metadata-only registration from an inspected file. No inference is enabled.
    if (!inspection.ok) {
      return { ok: false, reason: "Inspection did not recognize a model file." };
    }
    set((s) => ({
      userModels: [
        ...s.userModels.filter((m) => m.manifest.modelId !== manifest.modelId),
        { manifest, registeredAt: Date.now(), inferenceReady: false },
      ],
    }));
    return { ok: true };
  },

  removeUserModel: (modelId) => {
    if (modelId === BUILTIN_MODEL.id) {
      return { ok: false, reason: "The built-in model slot is protected and cannot be removed." };
    }
    const exists = get().userModels.some((m) => m.manifest.modelId === modelId);
    if (!exists) return { ok: false, reason: "No such user-registered model." };
    set((s) => ({ userModels: s.userModels.filter((m) => m.manifest.modelId !== modelId) }));
    return { ok: true };
  },

  clearInspections: () => set({ inspections: [] }),

  resolveFor: async (request) => {
    const s = get();
    return resolveModelForOperation(
      { builtin: s.builtin, userModels: s.userModels },
      request
    );
  },

  isModelUsableFor: async (modelId, operation, stems) => {
    if (!modelId) {
      return { usable: false, reason: "No model selected." };
    }
    const resolution = await get().resolveFor({
      operation,
      requiredStems: stems,
      preferredModelId: modelId,
      device: null,
    });
    return {
      usable: resolution.status === "ready",
      reason: "reason" in resolution ? resolution.reason : "Resolved.",
    };
  },

  storageUsage: () => {
    const s = get();
    const declaredBytes = calculateDiskUsage(s.userModels);
    return webPreviewStorageUsage(s.userModels.length, INFERENCE_ADAPTERS.length, declaredBytes);
  },
}));

export { getAdapter, INFERENCE_ADAPTERS };
