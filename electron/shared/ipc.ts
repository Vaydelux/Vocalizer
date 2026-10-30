/**
 * Shared IPC contracts — the single source of truth for every Electron
 * main ↔ preload ↔ renderer operation.
 *
 * Every request is a discriminated union validated by Zod on the main side
 * before any work runs. No free-form strings reach FFmpeg: the main process
 * builds argv from typed, validated parameters and always spawns with
 * `shell: false`. Untrusted paths are validated against the application data
 * root before use.
 *
 * This module is isomorphic (zod + types only) so main, preload, and the
 * Next.js renderer all import the same contracts.
 */

import { z } from "zod";

/* ------------------------------- channels ---------------------------------- */

export const IPC = {
  DIALOG_OPEN_FILES: "dialog:openFiles",
  DIALOG_SAVE_FILE: "dialog:saveFile",
  DIALOG_OPEN_DIRECTORY: "dialog:openDirectory",
  FFPROBE_METADATA: "ffprobe:metadata",
  FFMPEG_RUN: "ffmpeg:run",
  FFMPEG_CANCEL: "ffmpeg:cancel",
  FFMPEG_PROGRESS: "ffmpeg:progress",
  FFMPEG_REVEAL_OUTPUT: "ffmpeg:revealOutput",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SYSTEM_INFO: "system:info",
  APP_RESOLVE_PATH: "app:resolvePath",
  INFERENCE_STATUS: "inference:status",
  INFERENCE_SEPARATE: "inference:separate",
  INFERENCE_CANCEL: "inference:cancel",
  INFERENCE_PROGRESS: "inference:progress",
  INFERENCE_REVEAL_STEM: "inference:revealStem",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/* ------------------------------- dialogs ----------------------------------- */

export const openFilesRequestSchema = z.object({
  filters: z
    .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
    .optional(),
  multiple: z.boolean().default(true),
});
export type OpenFilesRequest = z.infer<typeof openFilesRequestSchema>;
export type OpenFilesResponse = string[];

export const saveFileRequestSchema = z.object({
  defaultName: z.string().max(200).optional(),
  filters: z
    .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
    .optional(),
});
export type SaveFileRequest = z.infer<typeof saveFileRequestSchema>;
export type SaveFileResponse = string | null;

export const openDirectoryRequestSchema = z.object({
  title: z.string().max(200).optional(),
});
export type OpenDirectoryRequest = z.infer<typeof openDirectoryRequestSchema>;
export type OpenDirectoryResponse = string | null;

/* ------------------------------- ffprobe ----------------------------------- */

export const ffprobeRequestSchema = z.object({ path: z.string().min(1).max(4096) });
export type FfprobeRequest = z.infer<typeof ffprobeRequestSchema>;

export interface NativeAudioMeta {
  duration: number;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  format: string | null;
  bitrateKbps: number | null;
  sizeBytes: number;
}

/* ------------------------------- ffmpeg ------------------------------------ */

export const ffmpegFormatSchema = z.enum(["wav", "wav24", "mp3", "flac"]);
export type FfmpegFormat = z.infer<typeof ffmpegFormatSchema>;

const baseOp = {
  jobId: z.string().min(1).max(80),
  outputFormat: ffmpegFormatSchema,
  outputPath: z.string().min(1).max(4096),
} as const;

export const trimOpSchema = z.object({
  ...baseOp,
  kind: z.literal("trim"),
  inputPath: z.string().min(1).max(4096),
  startSec: z.number().min(0).max(24 * 3600),
  endSec: z.number().min(0).max(24 * 3600),
});
export const joinOpSchema = z.object({
  ...baseOp,
  kind: z.literal("join"),
  inputPaths: z.array(z.string().min(1).max(4096)).min(2).max(64),
  crossfadeSec: z.number().min(0).max(10).default(0),
});
export const pitchOpSchema = z.object({
  ...baseOp,
  kind: z.literal("pitch"),
  inputPath: z.string().min(1).max(4096),
  semitones: z.number().int().min(-12).max(12),
  cents: z.number().int().min(-100).max(100),
  tempo: z.number().min(0.25).max(4),
  preserveDuration: z.boolean(),
});
export const convertOpSchema = z.object({
  ...baseOp,
  kind: z.literal("convert"),
  inputPath: z.string().min(1).max(4096),
  sampleRate: z.union([z.literal(44100), z.literal(48000), z.null()]).default(null),
});
export const mixOpSchema = z.object({
  ...baseOp,
  kind: z.literal("mix"),
  instrumentalPath: z.string().min(1).max(4096),
  vocalPath: z.string().min(1).max(4096),
  vocalStartSec: z.number().min(0).max(24 * 3600),
  vocalGainDb: z.number().min(-40).max(40).default(0),
  instrumentalGainDb: z.number().min(-40).max(40).default(0),
});

export const ffmpegOpSchema = z.discriminatedUnion("kind", [
  trimOpSchema,
  joinOpSchema,
  pitchOpSchema,
  convertOpSchema,
  mixOpSchema,
]);
export type FfmpegOp = z.infer<typeof ffmpegOpSchema>;

export interface FfmpegResult {
  outputPath: string;
  sizeBytes: number;
  durationSec: number;
  /** Verified by re-probing the output with FFprobe. */
  verified: boolean;
}

export interface FfmpegProgress {
  jobId: string;
  /** 0..1 or null for indeterminate. */
  progress: number | null;
  stage: string;
}

export const cancelRequestSchema = z.object({ jobId: z.string().min(1).max(80) });
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

/* ------------------------------- inference --------------------------------- */

export const inferenceStatusSchema = z.object({}).optional();
/** Only reveal stems from a completed job recorded by the privileged main process. */
export const revealInferenceStemSchema = z.object({
  jobId: z.string().min(1).max(80),
  stem: z.enum(["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"]),
});
export interface InferenceStatus {
  workerAvailable: boolean;
  runtimes: string[];
  devices: ("cpu" | "cuda" | "directml")[];
  defaultModelInstalled: boolean;
}

export const inferenceSeparateRequestSchema = z.object({
  jobId: z.string().min(1).max(80),
  modelId: z.string().min(1).max(120),
  modelPath: z.string().min(1).max(4096),
  architecture: z.enum(["mdx-net", "demucs", "bs-roformer", "melband-roformer", "vr-arch", "mdxc"]),
  configPath: z.string().min(1).max(4096).optional(),
  inputPath: z.string().min(1).max(4096),
  outputDir: z.string().min(1).max(4096),
  requestedStems: z.array(z.enum(["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"])).min(1),
  outputFormat: z.enum(["wav", "wav24", "mp3", "flac"]),
  device: z.enum(["auto", "cpu", "cuda", "directml"]),
});
export type InferenceSeparateRequest = z.infer<typeof inferenceSeparateRequestSchema>;

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

export interface InferenceProgress {
  jobId: string;
  progress: number | null;
  stage: string;
}

/* ------------------------------- settings ---------------------------------- */

export const nativeSettingsSchema = z.object({
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
export type NativeSettings = z.infer<typeof nativeSettingsSchema>;

/* ------------------------------- system ------------------------------------ */

export type ResolvedPathKind = "userData" | "models" | "cache" | "jobs" | "logs" | "resources";

export const resolvePathRequestSchema = z.object({
  kind: z.enum(["userData", "models", "cache", "jobs", "logs", "resources"]),
});
export type ResolvePathRequest = z.infer<typeof resolvePathRequestSchema>;
export type ResolvePathResponse = string;

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
export interface StudioNativeApi {
  isNative: true;
  /** Resolve the real filesystem path of a renderer File selection (Electron webUtils). */
  getPathForFile(file: File): string;
  openFiles(req?: OpenFilesRequest): Promise<OpenFilesResponse>;
  saveFile(req?: SaveFileRequest): Promise<SaveFileResponse>;
  openDirectory(req?: OpenDirectoryRequest): Promise<OpenDirectoryResponse>;
  probeMetadata(req: { path: string }): Promise<NativeAudioMeta>;
  runFfmpeg(op: FfmpegOp): Promise<FfmpegResult>;
  cancelFfmpeg(req: CancelRequest): Promise<{ cancelled: boolean }>;
  revealFfmpegOutput(req: { jobId: string }): Promise<{ revealed: boolean }>;
  onFfmpegProgress(cb: (p: FfmpegProgress) => void): () => void;
  // Inference (AI separation) — honestly unavailable until a worker is bundled.
  inferenceStatus(): Promise<InferenceStatus>;
  runInference(req: InferenceSeparateRequest): Promise<InferenceSeparateResult>;
  cancelInference(req: { jobId: string }): Promise<{ cancelled: boolean }>;
  revealInferenceStem(req: { jobId: string; stem: InferenceStemResult["stem"] }): Promise<{ revealed: boolean }>;
  onInferenceProgress(cb: (p: InferenceProgress) => void): () => void;
  getSettings(): Promise<NativeSettings>;
  setSettings(patch: Partial<NativeSettings>): Promise<NativeSettings>;
  resolvePath(req: ResolvePathRequest): Promise<ResolvePathResponse>;
  systemInfo(): Promise<NativeSystemInfo>;
}
