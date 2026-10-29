"use client";

/**
 * Model registry — metadata only in this build.
 *
 * Adapter contracts are typed registrations; none of them implement inference,
 * and all honestly report "unavailable". The reserved built-in fallback model
 * slot exists but is not installed (no bundled model in this phase), and it is
 * protected against removal by design.
 */

import {
  create,
} from "zustand";
import type {
  AdapterRecord,
  BuiltinModelRecord,
  ModelManifestValidation,
  ValidatedModelManifest,
} from "./types";
import { validateModelManifest } from "./schemas";

export const ADAPTERS: AdapterRecord[] = [
  {
    id: "onnxruntime.mdxnet",
    label: "MDX-Net (ONNX Runtime)",
    formats: [".onnx"],
    architectures: ["MDX-Net"],
    runtime: "onnxruntime-node / onnxruntime-gpu",
    availability: "unavailable",
    reason: "ONNX Runtime is not bundled with this build. Reserved for the embedded default model.",
    stub: true,
  },
  {
    id: "onnxruntime.vr-arch",
    label: "VR Architecture (ONNX Runtime)",
    formats: [".onnx"],
    architectures: ["VR Architecture"],
    runtime: "onnxruntime-node / onnxruntime-gpu",
    availability: "unavailable",
    reason: "ONNX Runtime is not bundled with this build.",
    stub: true,
  },
  {
    id: "pytorch.demucs",
    label: "Demucs (PyTorch)",
    formats: [".ckpt", ".pth", ".pt"],
    architectures: ["Demucs (HT-Demucs / v4)"],
    runtime: "pytorch-cpu / pytorch-cuda",
    availability: "unavailable",
    reason: "PyTorch runtime is not bundled. Python inference integration is a later phase.",
    stub: true,
  },
  {
    id: "pytorch.bs-roformer",
    label: "BS-RoFormer (PyTorch)",
    formats: [".ckpt", ".safetensors"],
    architectures: ["BS-RoFormer"],
    runtime: "pytorch-cpu / pytorch-cuda",
    availability: "unavailable",
    reason: "PyTorch runtime is not bundled.",
    stub: true,
  },
  {
    id: "pytorch.melband-roformer",
    label: "MelBand RoFormer (PyTorch)",
    formats: [".ckpt", ".safetensors"],
    architectures: ["MelBand RoFormer"],
    runtime: "pytorch-cpu / pytorch-cuda",
    availability: "unavailable",
    reason: "PyTorch runtime is not bundled.",
    stub: true,
  },
  {
    id: "generic.onnx",
    label: "Generic ONNX adapter",
    formats: [".onnx"],
    architectures: ["(declared by manifest)"],
    runtime: "onnxruntime-*",
    availability: "unavailable",
    reason: "Typed registration only. No inference implementation in this build.",
    stub: true,
  },
];

export const BUILTIN_MODEL: BuiltinModelRecord = {
  id: "builtin.mdxnet-vocals.onnx.v1",
  name: "Built-in vocal/instrumental model (reserved slot)",
  architecture: "MDX-Net",
  format: ".onnx",
  adapterId: "onnxruntime.mdxnet",
  supportedStems: ["Vocals", "Instrumental"],
  status: "not-installed",
  protectedBundledResource: true,
  sizeBytes: 0,
  note:
    "A verified MDX-Net-compatible ONNX model will be bundled with application resources in a later phase (checksum-protected, offline, non-removable). Until then this slot reports unavailable and the separation fallback is not ready.",
};

export interface UserModelRecord {
  manifest: ValidatedModelManifest;
  registeredAt: number;
  /** Always false in this build — a valid manifest never enables inference. */
  inferenceReady: false;
}

interface ModelsStore {
  adapters: AdapterRecord[];
  builtin: BuiltinModelRecord;
  userModels: UserModelRecord[];
  validations: ModelManifestValidation[];
  validateAndRegister: (raw: string) => ModelManifestValidation;
  removeUserModel: (modelId: string) => { ok: boolean; reason?: string };
  isModelUsable: (modelId: string | null) => { usable: boolean; reason: string };
}

export const useModels = create<ModelsStore>((set, get) => ({
  adapters: ADAPTERS,
  builtin: BUILTIN_MODEL,
  userModels: [],
  validations: [],
  validateAndRegister: (raw) => {
    const validated = validateModelManifest(raw);
    const result: ModelManifestValidation = validated.ok
      ? { ok: true, manifest: validated.manifest!, validatedAt: Date.now() }
      : { ok: false, issues: validated.issues, validatedAt: Date.now() };
    set((s) => ({
      validations: [result, ...s.validations].slice(0, 20),
      // Only fully valid manifests with a KNOWN adapter get registered as metadata.
      userModels:
        result.ok && validated.compatibility.adapterKnown
          ? [
              ...s.userModels.filter((m) => m.manifest.modelId !== result.manifest!.modelId),
              { manifest: result.manifest!, registeredAt: Date.now(), inferenceReady: false },
            ]
          : s.userModels,
    }));
    return result;
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
  isModelUsable: (modelId) => {
    if (!modelId) {
      return { usable: false, reason: "No model selected. Install or select a compatible model when AI processing support is enabled." };
    }
    if (modelId === BUILTIN_MODEL.id) {
      return {
        usable: false,
        reason: "The built-in model is not installed in this phase. Audio separation is not available yet.",
      };
    }
    const user = get().userModels.find((m) => m.manifest.modelId === modelId);
    if (!user) {
      return { usable: false, reason: "The selected model is not registered." };
    }
    return {
      usable: false,
      reason: `Registered model "${user.manifest.displayName}" has no compatible runtime in this build (${user.manifest.requiredRuntime}). Inference stays unavailable.`,
    };
  },
}));
