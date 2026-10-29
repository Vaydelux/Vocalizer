/**
 * Inference worker manager — Electron-side lifecycle for the bundled Python
 * inference worker. Spawns the worker process (when a bundled runtime exists),
 * enforces the JSON-over-stdio protocol, routes progress/results/errors, and
 * handles cancellation + shutdown.
 *
 * HONEST STATUS: this manager is fully implemented and type-checked, but the
 * actual Python worker binary (python-audio-separator + PyTorch/ONNX Runtime)
 * is NOT bundled in this repository and cannot be built or run in this Linux
 * sandbox. `isWorkerAvailable()` returns false until the worker is bundled on a
 * Windows build host. No inference is fabricated.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseWorkerResponse,
  serializeWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "../../shared/inference-protocol";
import { studioError } from "./errors";

let cachedWorkerPath: string | null | undefined;
let cachedRuntimes: string[] | null = null;

/** Resolve the bundled worker entry. Returns null when no worker is bundled. */
function resolveWorkerPath(): string | null {
  if (cachedWorkerPath !== undefined) return cachedWorkerPath;
  const candidates = [
    // Packaged: resources/inference/worker/worker.py (or a frozen exe)
    path.join(process.resourcesPath, "inference", "worker", "worker.py"),
    path.join(process.resourcesPath, "inference", "worker", "worker.exe"),
    // Dev placeholder (does not exist in this repo)
    path.join(__dirname, "..", "..", "..", "resources", "inference", "worker", "worker.py"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        cachedWorkerPath = c;
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  cachedWorkerPath = null;
  return null;
}

/** Resolve a bundled Python interpreter, if any. Returns null otherwise. */
function resolvePythonPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, "inference", "runtime", "python.exe"),
    path.join(process.resourcesPath, "inference", "runtime", "bin", "python"),
    path.join(__dirname, "..", "..", "..", "resources", "inference", "runtime", "python.exe"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** True only when a bundled worker + runtime are actually present on disk. */
export function isWorkerAvailable(): boolean {
  return !!resolveWorkerPath() && !!resolvePythonPath();
}

interface PendingRequest {
  resolve: (r: WorkerResponse) => void;
  reject: (err: unknown) => void;
  onProgress?: (p: { progress: number | null; stage: string }) => void;
}

let workerProc: ChildProcess | null = null;
let ready = false;
let seq = 0;
const pending = new Map<string, PendingRequest>();
let stdoutBuffer = "";

/** Spawn the worker (once) and wait for its `ready` message. */
async function ensureWorker(): Promise<void> {
  if (workerProc && ready) return;
  const workerPath = resolveWorkerPath();
  const pythonPath = resolvePythonPath();
  if (!workerPath || !pythonPath) {
    throw studioError(
      "RUNTIME_UNAVAILABLE",
      "No bundled inference worker is present. The Python runtime + python-audio-separator + model weights must be bundled on a Windows build host."
    );
  }
  workerProc = spawn(pythonPath, [workerPath], { shell: false, windowsHide: true });
  workerProc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    let nl = stdoutBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = stdoutBuffer.slice(0, nl).trim();
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      nl = stdoutBuffer.indexOf("\n");
      if (!line) continue;
      const msg = parseWorkerResponse(line);
      if (!msg) continue;
      routeResponse(msg);
    }
  });
  workerProc.stderr?.on("data", () => {
    // Worker diagnostics on stderr — not surfaced to the user verbatim.
  });
  workerProc.on("error", (err) => {
    ready = false;
    failAll(studioError("RUNTIME_UNAVAILABLE", `Worker spawn failed: ${err.message}`));
  });
  workerProc.on("close", (code) => {
    ready = false;
    workerProc = null;
    if (code !== 0 && code !== null) {
      failAll(studioError("INFERENCE_FAILED", `Worker exited with code ${code}.`));
    }
  });
  // Send init and wait for ready.
  send({ type: "init", protocolVersion: 1 });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(studioError("RUNTIME_UNAVAILABLE", "Worker did not become ready in time."));
    }, 30000);
    const check = () => {
      if (ready) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

function send(req: WorkerRequest): void {
  if (!workerProc?.stdin) {
    throw studioError("RUNTIME_UNAVAILABLE", "Worker stdin is not available.");
  }
  workerProc.stdin.write(serializeWorkerRequest(req) + "\n");
}

function routeResponse(msg: WorkerResponse): void {
  if (msg.type === "ready") {
    ready = true;
    cachedRuntimes = msg.runtimes ? Object.keys(msg.runtimes) : [];
    return;
  }
  if (msg.type === "progress") {
    const p = pending.get(msg.requestId);
    p?.onProgress?.({ progress: msg.progress, stage: msg.stage });
    return;
  }
  if (msg.type === "result" || msg.type === "error") {
    const p = pending.get(msg.requestId);
    if (!p) return;
    pending.delete(msg.requestId);
    if (msg.type === "result") p.resolve(msg);
    else p.reject(msg);
  }
}

function failAll(err: unknown): void {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

export interface SeparateParams {
  modelId: string;
  modelPath: string;
  architecture: "mdx-net" | "demucs" | "bs-roformer" | "melband-roformer" | "vr-arch" | "mdxc";
  configPath?: string;
  inputPath: string;
  outputDir: string;
  requestedStems: string[];
  outputFormat: "wav" | "wav24" | "mp3" | "flac";
  device: "auto" | "cpu" | "cuda" | "directml";
  onProgress?: (p: { progress: number | null; stage: string }) => void;
}

/** Run a separation. Throws a typed error if no worker is bundled. */
export async function runSeparation(params: SeparateParams): Promise<WorkerResponse> {
  await ensureWorker();
  const requestId = `req-${++seq}-${Date.now().toString(36)}`;
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress: params.onProgress });
    send({
      type: "separate",
      requestId,
      modelId: params.modelId,
      modelPath: params.modelPath,
      architecture: params.architecture,
      configPath: params.configPath,
      inputPath: params.inputPath,
      outputDir: params.outputDir,
      requestedStems: params.requestedStems as ("Vocals" | "Instrumental" | "Drums" | "Bass" | "Guitar" | "Piano" | "Other")[],
      outputFormat: params.outputFormat,
      device: params.device,
    });
  });
}

/** Cancel a pending separation request. */
export function cancelSeparation(requestId: string): void {
  if (!workerProc) return;
  try {
    send({ type: "cancel", requestId });
  } catch {
    /* worker already gone */
  }
}

/** Shut the worker down cleanly on app quit. */
export function shutdownWorker(): void {
  if (!workerProc) return;
  try {
    send({ type: "shutdown" });
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      workerProc?.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    workerProc = null;
    ready = false;
  }, 2000);
}

/** Detected runtimes from the worker's ready message (empty until bundled). */
export function detectedRuntimes(): string[] {
  return cachedRuntimes ?? [];
}
