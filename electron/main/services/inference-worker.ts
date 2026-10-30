/**
 * Inference worker manager — Electron-side lifecycle for the bundled Python
 * inference worker. Spawns the worker process (when a bundled runtime exists),
 * enforces the JSON-over-stdio protocol, routes progress/results/errors, and
 * handles cancellation + shutdown.
 *
 * WORKER LAYOUTS (first match wins; availability is detected from disk, never
 * assumed — no inference is fabricated):
 *   1. Frozen PyInstaller onedir executable (self-contained; no Python needed).
 *      - packaged:  <resourcesPath>/inference/inference-worker(.exe)
 *        (electron-builder extraResources copies inference-dist/windows-x64/
 *         → resources/inference/ — see electron-builder.yml)
 *      - dev build: <repo>/inference-dist/windows-x64/inference-worker(.exe)
 *   2. Script + interpreter:
 *      - packaged:  <resourcesPath>/inference/worker/worker.py run by
 *        <resourcesPath>/inference/runtime/python(.exe)
 *      - dev opt-in: <repo>/inference/worker/main.py run by the interpreter
 *        named in LAS_INFERENCE_PYTHON (never guessed from PATH).
 *
 * HONEST STATUS: no runtime is bundled in this repository, so
 * `isWorkerAvailable()` returns false in the development sandbox; it can only
 * return true on a machine where one of the layouts above actually exists
 * (a Windows packaging host, or a dev box with LAS_INFERENCE_PYTHON set).
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
import { getFfprobePath } from "./paths";

let cachedWorker: ResolvedWorker | null | undefined;
let cachedRuntimes: string[] | null = null;

interface ResolvedWorker {
  /** "frozen" = self-contained PyInstaller exe; "script" = interpreter + .py. */
  mode: "frozen" | "script";
  /** Executable to spawn. */
  command: string;
  /** Extra argv (the script path in script mode; empty in frozen mode). */
  args: string[];
  /** Human-readable description for error messages. */
  label: string;
}

const WORKER_EXE = process.platform === "win32" ? "inference-worker.exe" : "inference-worker";

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Repo root, derived from the compiled file location (electron/dist/main/). */
function repoRoot(): string {
  return path.join(__dirname, "..", "..", "..");
}

/** Layout 1 — frozen onedir executable (packaged app or a local inference-dist build). */
function resolveFrozenExe(): string | null {
  const resources = typeof process.resourcesPath === "string" ? process.resourcesPath : null;
  return firstExisting([
    ...(resources ? [path.join(resources, "inference", WORKER_EXE)] : []),
    path.join(repoRoot(), "inference-dist", "windows-x64", WORKER_EXE),
  ]);
}

/** Layout 2 — worker script + an explicitly resolvable interpreter. */
function resolveScriptWorker(): ResolvedWorker | null {
  const resources = typeof process.resourcesPath === "string" ? process.resourcesPath : null;
  const script = firstExisting([
    ...(resources ? [path.join(resources, "inference", "worker", "worker.py")] : []),
    path.join(repoRoot(), "inference", "worker", "main.py"),
  ]);
  if (!script) return null;
  const pyExe = process.platform === "win32" ? "python.exe" : path.join("bin", "python");
  const python = firstExisting([
    // Dev opt-in only — an interpreter is never guessed from PATH.
    ...(process.env.LAS_INFERENCE_PYTHON ? [process.env.LAS_INFERENCE_PYTHON] : []),
    ...(resources ? [path.join(resources, "inference", "runtime", pyExe)] : []),
  ]);
  if (!python) return null;
  return { mode: "script", command: python, args: [script], label: `${python} ${script}` };
}

/** Resolve the worker to spawn. Returns null when no worker is bundled. */
function resolveWorker(): ResolvedWorker | null {
  if (cachedWorker !== undefined) return cachedWorker;
  const frozenExe = resolveFrozenExe();
  if (frozenExe) {
    cachedWorker = { mode: "frozen", command: frozenExe, args: [], label: frozenExe };
    return cachedWorker;
  }
  cachedWorker = resolveScriptWorker();
  return cachedWorker;
}

/** True only when a worker layout is ACTUALLY present on disk. */
export function isWorkerAvailable(): boolean {
  return resolveWorker() !== null;
}

interface PendingRequest {
  resolve: (r: WorkerResponse) => void;
  reject: (err: unknown) => void;
  onProgress?: (p: { progress: number | null; stage: string }) => void;
}

/** Kill the frozen worker and its inference child on Windows.
 * Terminating only the parent can strand a PyInstaller --job subprocess. */
function terminateWorkerTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false, windowsHide: true, stdio: "ignore",
    });
    killer.once("error", () => {
      try { child.kill(); } catch { /* already exited */ }
    });
  } else {
    try { child.kill(); } catch { /* already exited */ }
  }
}

let workerProc: ChildProcess | null = null;
let ready = false;
let startingWorker: Promise<void> | null = null;
const pending = new Map<string, PendingRequest>();
let stdoutBuffer = "";

/** Serialize worker startup so simultaneous jobs never spawn duplicate parents. */
function ensureWorker(): Promise<void> {
  if (workerProc && ready) return Promise.resolve();
  if (!startingWorker) {
    startingWorker = startWorker().finally(() => {
      startingWorker = null;
    });
  }
  return startingWorker;
}

/** Spawn the worker and await the real protocol v1 ready handshake. */
async function startWorker(): Promise<void> {
  const worker = resolveWorker();
  if (!worker) {
    throw studioError(
      "RUNTIME_UNAVAILABLE",
      "No inference worker is present. Package the PyInstaller onedir worker (inference-dist/windows-x64) on a Windows build host, or set LAS_INFERENCE_PYTHON for script-mode development."
    );
  }
  const ffprobe = getFfprobePath();
  const env = { ...process.env };
  if (ffprobe) {
    env.LAS_FFPROBE_PATH = ffprobe;
    // Audio Separator also invokes FFmpeg as a subprocess; preserve its path.
    env.PATH = [path.dirname(ffprobe), process.env.PATH ?? ""].join(path.delimiter);
  }
  const child = spawn(worker.command, worker.args, { shell: false, windowsHide: true, env });
  workerProc = child;
  stdoutBuffer = "";
  const rejectInvalidProtocol = (description: string) => {
    if (workerProc !== child) return;
    ready = false;
    failAll(studioError("INFERENCE_FAILED", description));
    terminateWorkerTree(child);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    if (workerProc !== child) return;
    stdoutBuffer += chunk.toString();
    if (stdoutBuffer.length > 1_048_576) {
      rejectInvalidProtocol("Inference worker exceeded the maximum protocol message size.");
      return;
    }
    let nl = stdoutBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = stdoutBuffer.slice(0, nl).trim();
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      nl = stdoutBuffer.indexOf("\n");
      if (line) {
        const msg = parseWorkerResponse(line);
        if (!msg) {
          rejectInvalidProtocol("Inference worker emitted invalid protocol output.");
          return;
        }
        routeResponse(msg);
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    // Diagnostics are opt-in; never send untrusted worker text to the renderer.
    if (process.argv.includes("--vocalizer-debug")) {
      console.error("[Vocalizer inference worker]", chunk.toString().slice(0, 4096));
    }
  });
  child.stdin?.on("error", () => {
    if (workerProc === child) rejectInvalidProtocol("Inference worker closed its command stream.");
  });
  child.on("error", (err) => {
    if (workerProc !== child) return;
    ready = false;
    workerProc = null;
    failAll(studioError("RUNTIME_UNAVAILABLE", `Worker spawn failed: ${err.message}`));
  });
  child.on("close", (code) => {
    if (workerProc !== child) return;
    ready = false;
    workerProc = null;
    stdoutBuffer = "";
    // A clean shutdown during a pending job is still a failed job.
    failAll(studioError("INFERENCE_FAILED", `Worker exited before all requests completed (code ${code}).`));
  });
  // Wait for a ready handshake with a bounded, cleaned-up poll.
  // Previously the 100 ms timer loop continued indefinitely after timeout.
  const startingProcess = workerProc;
  send({ type: "init", protocolVersion: 1 });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      if (workerProc === startingProcess) {
        if (startingProcess) terminateWorkerTree(startingProcess);
      }
      reject(studioError("RUNTIME_UNAVAILABLE", "Worker did not become ready in time."));
    }, 30000);
    const poll = setInterval(() => {
      if (workerProc !== startingProcess) {
        clearTimeout(timeout);
        clearInterval(poll);
        reject(studioError("RUNTIME_UNAVAILABLE", "Inference worker exited before initialization."));
      } else if (ready) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    }, 100);
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
  jobId: string;
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
  const requestId = params.jobId;
  if (pending.has(requestId)) {
    throw studioError("INFERENCE_FAILED", "An inference job with this ID is already running.");
  }
  if (pending.size > 0) {
    throw studioError("INFERENCE_FAILED", "Another inference job is still running. Queue the next job after it finishes.");
  }
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress: params.onProgress });
    try {
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
    } catch (err) {
      pending.delete(requestId);
      reject(err);
    }
  });
}

/** Cancel a pending separation request. */
export function cancelSeparation(requestId: string): boolean {
  if (!workerProc || !pending.has(requestId)) return false;
  try {
    send({ type: "cancel", requestId });
    return true;
  } catch {
    return false; // The worker has already exited; no cancellation confirmed.
  }
}

/** Shut the worker down cleanly on app quit. */
export function shutdownWorker(): void {
  const shuttingDown = workerProc;
  if (!shuttingDown) return;
  try {
    send({ type: "shutdown" });
  } catch {
    // The transport is already broken; the guarded timeout still cleans up.
  }
  setTimeout(() => {
    // Never kill a NEW worker that was started after this one exited.
    if (workerProc !== shuttingDown) return;
    terminateWorkerTree(shuttingDown);
    workerProc = null;
    ready = false;
    failAll(studioError("RUNTIME_UNAVAILABLE", "Inference worker was shut down."));
  }, 2000);
}

/** Detected runtimes from the worker's ready message (empty until bundled). */
export function detectedRuntimes(): string[] {
  return cachedRuntimes ?? [];
}
