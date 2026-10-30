/**
 * Inference worker protocol — the typed JSON-over-stdio contract between the
 * Electron main process and the (future) bundled Python inference worker.
 *
 * SECURITY: the worker receives ONLY validated, typed messages. No arbitrary
 * commands, no shell strings, no code. Model IDs, paths, stems, and device
 * selections are all validated by the main process before a message is sent.
 * Downloaded checkpoints are treated as untrusted data.
 *
 * This module is the single source of truth for the wire format. The actual
 * Python worker (python-audio-separator + PyTorch/ONNX Runtime) is a separate
 * artifact that must be bundled on a Windows build host — it is NOT present in
 * this repository and cannot be run or tested in this environment. The protocol
 * is implemented now so the Electron side is correct and type-checked.
 */

import { z } from "zod";

/* ------------------------------- messages ---------------------------------- */

export const inferenceInitSchema = z.object({
  type: z.literal("init"),
  /** Bundled worker protocol version — the worker must echo it back. */
  protocolVersion: z.literal(1),
});
export const inferenceLoadModelSchema = z.object({
  type: z.literal("load-model"),
  requestId: z.string().min(1),
  modelId: z.string().min(1).max(120),
  /** Absolute path to the model file inside the approved model storage root. */
  modelPath: z.string().min(1).max(4096),
  architecture: z.enum(["mdx-net", "demucs", "bs-roformer", "melband-roformer", "vr-arch", "mdxc"]),
  /** Absolute path to an optional config file (JSON/YAML) inside the root. */
  configPath: z.string().min(1).max(4096).optional(),
  device: z.enum(["auto", "cpu", "cuda", "directml"]),
});
export const inferenceSeparateSchema = z.object({
  type: z.literal("separate"),
  requestId: z.string().min(1),
  modelId: z.string().min(1).max(120),
  /** Absolute path to the model file inside the approved model storage root. */
  modelPath: z.string().min(1).max(4096),
  architecture: z.enum(["mdx-net", "demucs", "bs-roformer", "melband-roformer", "vr-arch", "mdxc"]),
  configPath: z.string().min(1).max(4096).optional(),
  /** Absolute path to the source audio file (validated, inside an approved dir). */
  inputPath: z.string().min(1).max(4096),
  /** Output directory (validated, inside the app data root). One stem file per requested stem. */
  outputDir: z.string().min(1).max(4096),
  requestedStems: z.array(z.enum(["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"])).min(1),
  outputFormat: z.enum(["wav", "wav24", "mp3", "flac"]),
  device: z.enum(["auto", "cpu", "cuda", "directml"]),
  profile: z.enum(["low-memory", "balanced", "thorough"]).optional(),
});

/** Main → worker messages. */
export const workerRequestSchema = z.discriminatedUnion("type", [
  inferenceInitSchema,
  inferenceLoadModelSchema,
  inferenceSeparateSchema,
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("shutdown") }),
]);
export type WorkerRequest = z.infer<typeof workerRequestSchema>;

/* ------------------------------- responses --------------------------------- */

export const workerReadySchema = z.object({
  type: z.literal("ready"),
  protocolVersion: z.literal(1),
  devices: z.array(z.enum(["cpu", "cuda", "directml"])),
  /** Detected backend versions, e.g. { onnxruntime: "1.17", torch: "2.2" }. */
  runtimes: z.record(z.string(), z.string()),
});

export const workerProgressSchema = z.object({
  type: z.literal("progress"),
  requestId: z.string().min(1),
  /** 0..1 or null for indeterminate. */
  progress: z.number().min(0).max(1).nullable(),
  stage: z.string().max(80),
});

export const workerResultSchema = z.object({
  type: z.literal("result"),
  requestId: z.string().min(1),
  /** Absolute paths of the produced stem files. */
  stems: z.array(
    z.object({
      stem: z.enum(["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"]),
      path: z.string().min(1).max(4096),
    })
  ),
  /** The model that actually ran (may differ from the request after fallback). */
  modelUsed: z.string().min(1),
  deviceUsed: z.enum(["cpu", "cuda", "directml"]),
  fallbackUsed: z.boolean(),
});

export const workerErrorSchema = z.object({
  type: z.literal("error"),
  requestId: z.string().min(1),
  code: z.enum([
    "model-not-found",
    "model-corrupted",
    "architecture-unsupported",
    "device-unsupported",
    "out-of-memory",
    "inference-failed",
    "encoding-failed",
    "cancelled",
    "unknown",
  ]),
  message: z.string().max(400),
});

/** Worker → main messages. */
export const workerResponseSchema = z.discriminatedUnion("type", [
  workerReadySchema,
  workerProgressSchema,
  workerResultSchema,
  workerErrorSchema,
]);
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

/** Parse a line of worker stdout; returns null if it isn't a valid response. */
export function parseWorkerResponse(line: string): WorkerResponse | null {
  try {
    const parsed = JSON.parse(line);
    const result = workerResponseSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Serialize a main→worker request to a single stdout line. */
export function serializeWorkerRequest(req: WorkerRequest): string {
  return JSON.stringify(req);
}
