/**
 * Renderer-facing native IPC contracts (type-only).
 *
 * These mirror `electron/shared/ipc.ts` (the full zod-validated contracts used
 * by the main/preload build). The renderer imports only types from here so the
 * web preview never depends on Electron or zod for the native surface. The
 * shapes are kept in sync with the electron shared module.
 */

export type FfmpegFormat = "wav" | "wav24" | "mp3" | "flac";

export interface FfmpegOp {
  jobId: string;
  outputFormat: FfmpegFormat;
  outputPath: string;
  kind: "trim" | "join" | "pitch" | "convert" | "mix";
  // trim / pitch / convert
  inputPath?: string;
  startSec?: number;
  endSec?: number;
  semitones?: number;
  cents?: number;
  tempo?: number;
  preserveDuration?: boolean;
  sampleRate?: 44100 | 48000 | null;
  // join
  inputPaths?: string[];
  crossfadeSec?: number;
  // mix
  instrumentalPath?: string;
  vocalPath?: string;
  vocalStartSec?: number;
  vocalGainDb?: number;
  instrumentalGainDb?: number;
}

export interface FfmpegResult {
  outputPath: string;
  sizeBytes: number;
  durationSec: number;
  verified: boolean;
}

export interface FfmpegProgress {
  jobId: string;
  progress: number | null;
  stage: string;
}

export interface NativeAudioMeta {
  duration: number;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  format: string | null;
  bitrateKbps: number | null;
  sizeBytes: number;
}

export interface NativeSettings {
  theme: "dark" | "light";
  accent: "violet" | "indigo";
  exportFormat: "wav16" | "wav24" | "mp3";
  mp3Bitrate: 128 | 192 | 256 | 320;
  sampleRate: "auto" | 44100 | 48000;
  concurrency: 1 | 2;
  volume: number;
  preferredModelId: string | null;
  fallbackPolicy: "cpu-then-embedded" | "embedded-only" | "error";
}

export interface OpenFilesRequest {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}
export interface SaveFileRequest {
  defaultName?: string;
  filters?: { name: string; extensions: string[] }[];
}
export interface CancelRequest {
  jobId: string;
}
export type ResolvedPathKind = "userData" | "models" | "cache" | "jobs" | "logs" | "resources";

export interface NativeSystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  totalMemBytes: number;
  freeMemBytes: number;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  userDataPath: string;
  resourcesPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string | null;
  ffmpegAvailable: boolean;
  rubberBandAvailable: boolean;
  appDataFreeBytes: number | null;
}

/** The typed surface exposed on `window.studio` via contextBridge. */
export interface InferenceStemResult {
  stem: "Vocals" | "Instrumental" | "Drums" | "Bass" | "Guitar" | "Piano" | "Other";
  path: string;
}
export interface InferenceSeparateResult {
  jobId: string;
  stems: InferenceStemResult[];
  modelUsed: string;
  deviceUsed: "cpu" | "cuda" | "directml";
  fallbackUsed: boolean;
}
export interface InferenceStatus {
  workerAvailable: boolean;
  runtimes: string[];
  devices: ("cpu" | "cuda" | "directml")[];
  defaultModelInstalled: boolean;
}
export interface InferenceProgress {
  jobId: string;
  progress: number | null;
  stage: string;
}

export interface StudioNativeApi {
  isNative: true;
  /** Resolve the real filesystem path of a renderer File selection (Electron webUtils). */
  getPathForFile(file: File): string;
  openFiles(req?: OpenFilesRequest): Promise<string[]>;
  saveFile(req?: SaveFileRequest): Promise<string | null>;
  openDirectory(req?: { title?: string }): Promise<string | null>;
  probeMetadata(req: { path: string }): Promise<NativeAudioMeta>;
  runFfmpeg(op: FfmpegOp): Promise<FfmpegResult>;
  cancelFfmpeg(req: CancelRequest): Promise<{ cancelled: boolean }>;
  revealFfmpegOutput(req: { jobId: string }): Promise<{ revealed: boolean }>;
  onFfmpegProgress(cb: (p: FfmpegProgress) => void): () => void;
  // Inference (AI separation) — honestly unavailable until a worker is bundled.
  inferenceStatus(): Promise<InferenceStatus>;
  runInference(req: {
    jobId: string;
    modelId: string;
    modelPath: string;
    architecture: "mdx-net" | "demucs" | "bs-roformer" | "melband-roformer" | "vr-arch" | "mdxc";
    configPath?: string;
    inputPath: string;
    outputDir: string;
    requestedStems: string[];
    outputFormat: FfmpegFormat;
    device: "auto" | "cpu" | "cuda" | "directml";
  }): Promise<InferenceSeparateResult>;
  cancelInference(req: { jobId: string }): Promise<{ cancelled: boolean }>;
  revealInferenceStem(req: { jobId: string; stem: InferenceStemResult["stem"] }): Promise<{ revealed: boolean }>;
  onInferenceProgress(cb: (p: InferenceProgress) => void): () => void;
  getSettings(): Promise<NativeSettings>;
  setSettings(patch: Partial<NativeSettings>): Promise<NativeSettings>;
  resolvePath(req: { kind: ResolvedPathKind }): Promise<string>;
  systemInfo(): Promise<NativeSystemInfo>;
}
