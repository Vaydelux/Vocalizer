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
  signal: AbortSignal;
  /** progress 0..1, or null → indeterminate. */
  reportProgress: (progress: number | null, stage?: string) => void;
  log: (msg: string) => void;
}

export type JobTask = (ctx: JobCtx) => Promise<JobResultFile>;

/* ------------------------------ model registry ----------------------------- */

export type ModelAvailability = "available" | "unavailable";

export interface AdapterRecord {
  id: string;
  label: string;
  /** File formats this adapter can load, e.g. ".onnx". */
  formats: string[];
  architectures: string[];
  runtime: string;
  /** Real availability — all stubs are honestly unavailable in this build. */
  availability: ModelAvailability;
  reason: string;
  /** true → typed registration only, no inference implementation. */
  stub: true;
}

export interface BuiltinModelRecord {
  id: string;
  name: string;
  architecture: string;
  format: string;
  adapterId: string;
  supportedStems: string[];
  status: "not-installed" | "installed";
  protectedBundledResource: true;
  sizeBytes: number;
  note: string;
}

export type ModelManifestValidation =
  | { ok: true; manifest: ValidatedModelManifest; validatedAt: number }
  | { ok: false; issues: string[]; validatedAt: number };

export interface ValidatedModelManifest {
  schemaVersion: 1;
  modelId: string;
  displayName: string;
  modelVersion: string;
  architecture: string;
  format: string;
  adapterId: string;
  requiredRuntime: string;
  requiredFiles: string[];
  fileHashes: Record<string, string>;
  supportedStems: string[];
  deviceSupport: string[];
  provenance: string;
  license: string;
  origin: "bundled" | "user-installed";
  sizeBytes: number;
}

/* --------------------------------- settings -------------------------------- */

export type AccentColor = "violet" | "indigo";
export type ExportFormat = "wav16" | "wav24";
export type SampleRatePref = "auto" | 44100 | 48000;
export type FallbackPolicy = "cpu-then-embedded" | "embedded-only" | "error";

export interface StudioSettings {
  theme: "dark" | "light";
  accent: AccentColor;
  exportFormat: ExportFormat;
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
