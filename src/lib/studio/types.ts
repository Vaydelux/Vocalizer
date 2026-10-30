/**
 * Local Audio Studio — shared contracts (web preview runtime).
 *
 * These types mirror the shared package of the desktop (Electron) build so the
 * renderer code is portable 1:1. Internal IDs are always generated UUIDs — they
 * are never presented as filesystem identifiers or source-file IDs.
 */

import type { StudioErrorCode } from "./errors";

/* ---------------------------------- tracks --------------------------------- */

export type TrackStatus = "checking" | "ready" | "error";

export type MetaSource = "decoded" | "element" | "none";

export interface AudioMeta {
  /** Duration in seconds. Always real (decoded or measured). */
  duration: number;
  sampleRate: number | null;
  channels: number | null;
  lengthSamples: number | null;
  /** size*8/duration — labeled "effective" in the UI, never claimed as container bitrate. */
  effectiveBitrateKbps: number | null;
  /** Honest description of what was actually probed. */
  probeNote: string;
  metaSource: MetaSource;
}

export interface AudioTrack {
  /** Generated internal ID (UUID) — not a filesystem identifier. */
  id: string;
  name: string;
  size: number;
  mime: string;
  addedAt: number;
  status: TrackStatus;
  error?: { code: StudioErrorCode; message: string };
  file: File;
  url: string;
  meta: AudioMeta | null;
}

/* ----------------------------------- jobs ---------------------------------- */

export type JobState =
  | "queued"
  | "preparing"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type JobType = "export" | "analysis" | "convert";

export interface JobLogEntry {
  t: number;
  msg: string;
}

export interface JobResultFile {
  name: string;
  size: number;
  /** Object URL of the finalized output (web preview). The desktop build writes to disk instead. */
  url: string;
  mime: string;
  /** Native AI stems, shown after the worker returns verified paths. */
  stemFiles?: { stem: ModelStem; path: string }[];
  modelUsed?: string;
  deviceUsed?: "cpu" | "cuda" | "directml";
}

export interface Job {
  id: string;
  type: JobType;
  label: string;
  state: JobState;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** 0..1, or null for indeterminate. Never fabricated. */
  progress: number | null;
  stage: string | null;
  logs: JobLogEntry[];
  error: { code: StudioErrorCode; message: string } | null;
  result: JobResultFile | null;
}

export interface JobCtx {
  /** This job's stable id (used for native FFmpeg op + progress filtering). */
  jobId: string;
  signal: AbortSignal;
  /** progress 0..1, or null → indeterminate. */
  reportProgress: (progress: number | null, stage?: string) => void;
  log: (msg: string) => void;
}

export type JobTask = (ctx: JobCtx) => Promise<JobResultFile>;

/* ------------------------------ model registry ----------------------------- */

export type ModelAvailability = "available" | "unavailable";

/** Architecture families the registry recognizes (extension ≠ executable). */
export type ModelArchitecture =
  | "mdx-net"
  | "demucs"
  | "bs-roformer"
  | "melband-roformer"
  | "vr-arch"
  | "generic-onnx"
  | "custom-pytorch"
  | "custom-safetensors";

export type ModelFormat = ".onnx" | ".pth" | ".pt" | ".ckpt" | ".safetensors";

export type ModelRuntime =
  | "onnxruntime-cpu"
  | "onnxruntime-cuda"
  | "onnxruntime-directml"
  | "pytorch-cpu"
  | "pytorch-cuda"
  | "pytorch-directml"
  | "pytorch-mps";

export type DeviceType = "cpu" | "cuda" | "directml" | "mps";

export type ModelStem =
  | "Vocals"
  | "Instrumental"
  | "Drums"
  | "Bass"
  | "Guitar"
  | "Piano"
  | "Other";

/** Lifecycle of a model record (discriminated). Never inferred from a filename. */
export type ModelStatus =
  | "not-installed"
  | "installed"
  | "validating"
  | "ready"
  | "incompatible"
  | "corrupted"
  | "runtime-unavailable"
  | "unsupported";

export interface ModelCapabilities {
  supportedStems: ModelStem[];
  supportedDevices: DeviceType[];
  supportedOperations: ModelOperation[];
  supportsBatchProcessing: boolean;
}

/** Operations the future inference layer will expose. */
export type ModelOperation = "vocal-removal" | "stem-separation";

export interface AdapterRecord {
  id: string;
  label: string;
  formats: ModelFormat[];
  architectures: ModelArchitecture[];
  runtime: ModelRuntime[];
  /** Real availability — all stubs are honestly unavailable in this build. */
  availability: ModelAvailability;
  reason: string;
  /** true → typed registration only, no inference implementation. */
  stub: true;
}

export interface BuiltinModelRecord {
  id: string;
  name: string;
  architecture: ModelArchitecture;
  format: ModelFormat;
  adapterId: string;
  supportedStems: ModelStem[];
  status: "not-installed" | "installed";
  protectedBundledResource: true;
  sizeBytes: number;
  note: string;
}

/** A single model file reference with optional integrity metadata. */
export interface ModelFile {
  /** Relative path only; traversal/absolute/drive paths are rejected. */
  path: string;
  sha256?: string;
  sizeBytes?: number;
}

/** A registered user model — metadata only, never executable in this build. */
export interface UserModelRecord {
  manifest: ValidatedModelManifest;
  registeredAt: number;
  /** Always false in this build — a valid manifest never enables inference. */
  inferenceReady: false;
}

export type ModelManifestValidation =
  | { ok: true; manifest: ValidatedModelManifest; validatedAt: number }
  | { ok: false; issues: string[]; validatedAt: number };

export interface ValidatedModelManifest {
  schemaVersion: 1;
  modelId: string;
  displayName: string;
  modelVersion: string;
  architecture: ModelArchitecture;
  format: ModelFormat;
  adapterId: string;
  requiredRuntime: ModelRuntime;
  origin: "bundled" | "user-imported";
  supportedStems: ModelStem[];
  supportedDevices: DeviceType[];
  files: ModelFile[];
  provenance?: string;
  license: string;
}

/** Result of a local model-file inspection (no inference activation). */
export interface ModelInspectionResult {
  ok: boolean;
  fileName: string;
  format: ModelFormat | null;
  detectedArchitecture: ModelArchitecture | null;
  sizeBytes: number;
  sha256: string | null;
  associatedConfigs: string[];
  compatibleAdapterIds: string[];
  verdict: string;
  issues: string[];
}

/* --------------------------- fallback resolution --------------------------- */

export interface ModelResolutionRequest {
  operation: ModelOperation;
  requiredStems: ModelStem[];
  preferredModelId: string | null;
  /** Requested device; null = "any supported". */
  device: DeviceType | null;
}

export type ModelResolution =
  | { status: "ready"; modelId: string; adapterId: string; runtime: ModelRuntime; device: DeviceType; fallbackUsed: boolean; note: string }
  | { status: "no-preferred"; reason: string }
  | { status: "preferred-incompatible"; reason: string; modelId: string }
  | { status: "runtime-unavailable"; reason: string; modelId: string; adapterId: string }
  | { status: "device-incompatible"; reason: string; modelId: string }
  | { status: "no-compatible-model"; reason: string }
  | { status: "fallback-unavailable"; reason: string };

/* --------------------------------- settings -------------------------------- */

export type AccentColor = "violet" | "indigo";
export type ExportFormat = "wav16" | "wav24" | "mp3";
export type Mp3Bitrate = 128 | 192 | 256 | 320;
export type SampleRatePref = "auto" | 44100 | 48000;
export type FallbackPolicy = "cpu-then-embedded" | "embedded-only" | "error";

export interface StudioSettings {
  theme: "dark" | "light";
  accent: AccentColor;
  exportFormat: ExportFormat;
  /** Used when exportFormat === "mp3". */
  mp3Bitrate: Mp3Bitrate;
  sampleRate: SampleRatePref;
  /** Concurrent processing jobs. */
  concurrency: 1 | 2;
  volume: number;
  preferredModelId: string | null;
  fallbackPolicy: FallbackPolicy;
}

/* --------------------------------- analysis -------------------------------- */

export interface BpmAlternative {
  bpm: number;
  note: string;
}

export interface BpmResult {
  bpm: number;
  /** 0..1 — derived from peak separation of the autocorrelation. */
  confidence: number;
  alternatives: BpmAlternative[];
  analyzedSeconds: number;
  windowNote: string;
}

export interface KeyAlternative {
  label: string;
  correlation: number;
}

export interface KeyResult {
  label: string;
  tonic: string;
  scale: "major" | "minor";
  /** Pearson correlation against Krumhansl-Kessler profiles, 0..1 (negatives floored). */
  correlation: number;
  alternatives: KeyAlternative[];
}

/* ------------------------------- capabilities ------------------------------ */

export interface CapabilityItem {
  label: string;
  value: string;
  available: boolean | null;
  detail?: string;
}
