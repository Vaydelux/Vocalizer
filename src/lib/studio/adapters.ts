/**
 * Universal model-adapter contracts.
 *
 * Every adapter implements the `InferenceAdapter` surface so future model
 * families plug in without touching the rest of the application. In this build
 * ALL adapters are honest stubs: `isRuntimeAvailable()` resolves false, and
 * no inference is executed. A valid manifest + adapter never enables execution
 * until a verified runtime is bundled.
 *
 * Reserved (not implemented here, by design): runtime initialization, model
 * loading, audio preprocessing, model execution, postprocessing, progress
 * reporting, cancellation, and resource cleanup — these land with real
 * inference in a later phase.
 */

import type {
  AdapterRecord,
  DeviceType,
  ModelArchitecture,
  ModelCapabilities,
  ModelFormat,
  ModelManifestValidation,
  ModelOperation,
  ModelRuntime,
  ModelStem,
  ValidatedModelManifest,
} from "./types";

/** Typed runtime + capability probe surface for one model family. */
export interface InferenceAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportedArchitectures: ModelArchitecture[];
  readonly supportedFormats: ModelFormat[];
  readonly runtimes: ModelRuntime[];
  /** True only when a verified inference runtime is actually present. */
  isRuntimeAvailable(): Promise<boolean>;
  /** Structural validation of a manifest against this adapter's contract. */
  validateModel(manifest: ValidatedModelManifest): Promise<ModelValidationResult>;
  /** Declared capabilities for a manifest (never invents). */
  getCapabilities(manifest: ValidatedModelManifest): Promise<ModelCapabilities>;
}

/** Discriminated validation result — structured, never a fake success. */
export type ModelValidationResult =
  | { ok: true; adapterId: string; note: string }
  | { ok: false; adapterId: string; reason: ValidationFailure; detail: string };

export type ValidationFailure =
  | "format-mismatch"
  | "architecture-mismatch"
  | "runtime-unavailable"
  | "unsupported-stems"
  | "unsupported-device"
  | "missing-files"
  | "not-implemented";

/** Shared base: every adapter in this build reports runtime-unavailable. */
abstract class UnavailableAdapterBase implements InferenceAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly supportedArchitectures: ModelArchitecture[];
  abstract readonly supportedFormats: ModelFormat[];
  abstract readonly runtimes: ModelRuntime[];
  abstract readonly supportedStems: ModelStem[];
  abstract readonly supportedDevices: DeviceType[];
  abstract readonly supportedOperations: ModelOperation[];

  async isRuntimeAvailable(): Promise<boolean> {
    // Honest: no inference runtime is bundled in this build.
    return false;
  }

  async validateModel(manifest: ValidatedModelManifest): Promise<ModelValidationResult> {
    const formatOk = this.supportedFormats.includes(manifest.format);
    if (!formatOk) {
      return { ok: false, adapterId: this.id, reason: "format-mismatch", detail: `Adapter ${this.id} does not accept ${manifest.format}.` };
    }
    const archOk = this.supportedArchitectures.includes(manifest.architecture);
    if (!archOk) {
      return { ok: false, adapterId: this.id, reason: "architecture-mismatch", detail: `Architecture ${manifest.architecture} is not supported by ${this.id}.` };
    }
    const stemsOk = manifest.supportedStems.every((s) => this.supportedStems.includes(s));
    if (!stemsOk) {
      return { ok: false, adapterId: this.id, reason: "unsupported-stems", detail: "Manifest declares stems the adapter cannot produce." };
    }
    const devOk = manifest.supportedDevices.every((d) => this.supportedDevices.includes(d));
    if (!devOk) {
      return { ok: false, adapterId: this.id, reason: "unsupported-device", detail: "Manifest declares devices the adapter does not support." };
    }
    if (!manifest.files.every((f) => f.path)) {
      return { ok: false, adapterId: this.id, reason: "missing-files", detail: "Every file entry must declare a relative path." };
    }
    // Runtime is never bundled in this build — surface as not-implemented (not a fake success).
    return { ok: false, adapterId: this.id, reason: "runtime-unavailable", detail: `Runtime for ${this.id} is not bundled. The manifest is structurally valid but cannot run.` };
  }

  async getCapabilities(manifest: ValidatedModelManifest): Promise<ModelCapabilities> {
    return {
      supportedStems: manifest.supportedStems.filter((s) => this.supportedStems.includes(s)),
      supportedDevices: manifest.supportedDevices.filter((d) => this.supportedDevices.includes(d)),
      supportedOperations: this.supportedOperations.filter((o) => manifest.supportedStems.some((s) => this.supportedStems.includes(s))),
      supportsBatchProcessing: false,
    };
  }
}

class MdxNetOnnxAdapter extends UnavailableAdapterBase {
  readonly id = "onnxruntime.mdxnet";
  readonly label = "MDX-Net (ONNX Runtime)";
  readonly supportedArchitectures: ModelArchitecture[] = ["mdx-net"];
  readonly supportedFormats: ModelFormat[] = [".onnx"];
  readonly runtimes: ModelRuntime[] = ["onnxruntime-cpu", "onnxruntime-cuda", "onnxruntime-directml"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass", "Other"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

class VrArchOnnxAdapter extends UnavailableAdapterBase {
  readonly id = "onnxruntime.vr-arch";
  readonly label = "VR Architecture (ONNX Runtime)";
  readonly supportedArchitectures: ModelArchitecture[] = ["vr-arch"];
  readonly supportedFormats: ModelFormat[] = [".onnx"];
  readonly runtimes: ModelRuntime[] = ["onnxruntime-cpu", "onnxruntime-cuda", "onnxruntime-directml"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal"];
}

class DemucsAdapter extends UnavailableAdapterBase {
  readonly id = "pytorch.demucs";
  readonly label = "Demucs (PyTorch)";
  readonly supportedArchitectures: ModelArchitecture[] = ["demucs"];
  readonly supportedFormats: ModelFormat[] = [".ckpt", ".pth", ".pt", ".safetensors"];
  readonly runtimes: ModelRuntime[] = ["pytorch-cpu", "pytorch-cuda", "pytorch-directml", "pytorch-mps"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass", "Other"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml", "mps"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

class BsRoformerAdapter extends UnavailableAdapterBase {
  readonly id = "pytorch.bs-roformer";
  readonly label = "BS-RoFormer (PyTorch)";
  readonly supportedArchitectures: ModelArchitecture[] = ["bs-roformer"];
  readonly supportedFormats: ModelFormat[] = [".ckpt", ".safetensors"];
  readonly runtimes: ModelRuntime[] = ["pytorch-cpu", "pytorch-cuda", "pytorch-directml", "pytorch-mps"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml", "mps"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

class MelbandRoformerAdapter extends UnavailableAdapterBase {
  readonly id = "pytorch.melband-roformer";
  readonly label = "MelBand RoFormer (PyTorch)";
  readonly supportedArchitectures: ModelArchitecture[] = ["melband-roformer"];
  readonly supportedFormats: ModelFormat[] = [".ckpt", ".safetensors"];
  readonly runtimes: ModelRuntime[] = ["pytorch-cpu", "pytorch-cuda", "pytorch-directml", "pytorch-mps"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml", "mps"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

class GenericOnnxAdapter extends UnavailableAdapterBase {
  readonly id = "generic.onnx";
  readonly label = "Generic ONNX adapter";
  readonly supportedArchitectures: ModelArchitecture[] = ["generic-onnx"];
  readonly supportedFormats: ModelFormat[] = [".onnx"];
  readonly runtimes: ModelRuntime[] = ["onnxruntime-cpu", "onnxruntime-cuda", "onnxruntime-directml"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal"];
}

class CustomPytorchAdapter extends UnavailableAdapterBase {
  readonly id = "custom.pytorch";
  readonly label = "Custom PyTorch (verified architecture)";
  readonly supportedArchitectures: ModelArchitecture[] = ["custom-pytorch"];
  readonly supportedFormats: ModelFormat[] = [".ckpt", ".pth", ".pt", ".safetensors"];
  readonly runtimes: ModelRuntime[] = ["pytorch-cpu", "pytorch-cuda", "pytorch-directml", "pytorch-mps"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml", "mps"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

class CustomSafetensorsAdapter extends UnavailableAdapterBase {
  readonly id = "custom.safetensors";
  readonly label = "Custom Safetensors (verified architecture)";
  readonly supportedArchitectures: ModelArchitecture[] = ["custom-safetensors"];
  readonly supportedFormats: ModelFormat[] = [".safetensors"];
  readonly runtimes: ModelRuntime[] = ["pytorch-cpu", "pytorch-cuda", "pytorch-directml", "pytorch-mps"];
  readonly supportedStems: ModelStem[] = ["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"];
  readonly supportedDevices: DeviceType[] = ["cpu", "cuda", "directml", "mps"];
  readonly supportedOperations: ModelOperation[] = ["vocal-removal", "stem-separation"];
}

/** All registered adapters, keyed by id. Order is stable for UI rendering. */
export const INFERENCE_ADAPTERS: InferenceAdapter[] = [
  new MdxNetOnnxAdapter(),
  new VrArchOnnxAdapter(),
  new DemucsAdapter(),
  new BsRoformerAdapter(),
  new MelbandRoformerAdapter(),
  new GenericOnnxAdapter(),
  new CustomPytorchAdapter(),
  new CustomSafetensorsAdapter(),
];

const ADAPTER_BY_ID = new Map(INFERENCE_ADAPTERS.map((a) => [a.id, a] as const));

export function getAdapter(adapterId: string): InferenceAdapter | undefined {
  return ADAPTER_BY_ID.get(adapterId);
}

/** AdapterRecord (data view) derived from each typed adapter — for tables. */
export const ADAPTER_RECORDS: AdapterRecord[] = INFERENCE_ADAPTERS.map((a) => ({
  id: a.id,
  label: a.label,
  formats: a.supportedFormats,
  architectures: a.supportedArchitectures,
  runtime: a.runtimes,
  availability: "unavailable" as const,
  reason: "No verified inference runtime is bundled in this build. Adapter contract and capability declarations are registered; execution is not.",
  stub: true as const,
}));

/** Known adapter ids — used for manifest validation. */
export const KNOWN_ADAPTER_IDS: readonly string[] = INFERENCE_ADAPTERS.map((a) => a.id);

export type { ModelManifestValidation };
