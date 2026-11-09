/**
 * IPC handler registration — every channel validates its request with Zod and
 * authorizes the sender before doing any work. No handler trusts the renderer
 * payload shape; `shell: false` is enforced everywhere a process is spawned.
 */

import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  IPC,
  openFilesRequestSchema,
  saveFileRequestSchema,
  openDirectoryRequestSchema,
  ffprobeRequestSchema,
  ffmpegOpSchema,
  cancelRequestSchema,
  recordingStageSchema,
  revealInferenceStemSchema,
  inferenceWaveformRequestSchema,
  nativeStemRelinkRequestSchema,
  resolvePathRequestSchema,
  nativeSettingsSchema,
  type FfmpegProgress,
  type FfmpegOp,
  type NativeSettings,
} from "../../shared/ipc";
import { probeFile } from "../services/ffprobe";
import { generateNativeStemWaveform } from "../services/native-waveform";
import { WaveformRequestCoordinator } from "../../shared/waveform-request";
import { identifyNativeWaveformSource, nativeWaveformFingerprint, readNativeWaveformCache, writeNativeWaveformCache } from "../services/waveform-cache";
import { parseNativeStemInput } from "../../shared/stem-input";
import { parsePublishedStemFilename, doesRelinkedStemMatch } from "../../shared/published-stem";
import { runFfmpeg, cancelJob, toMainErrorPayload } from "../services/ffmpeg";
import { getSettings, setSettings } from "../services/settings";
import { stageRecordingBytes, discardRecordingFile } from "../services/recording-staging";
import { inferenceScratchBase, publishInferenceStems } from "../services/inference-outputs";
import { getFfmpegPath, getFfprobePath, resolvePathKind, cacheDir } from "../services/paths";
import { studioError } from "../services/errors";
import {
  isWorkerAvailable,
  detectedRuntimes,
  runSeparation,
  cancelSeparation,
  shutdownWorker,
} from "../services/inference-worker";
import {
  inferenceSeparateRequestSchema,
  type InferenceProgress,
  type InferenceSeparateResult,
} from "../../shared/ipc";

/** Authorize only the main application's top-level renderer.
 * Other Electron windows, unexpected subframes and external origins cannot
 * access filesystem dialogs, media execution or worker process controls. */
let getPrimaryWindow: (() => BrowserWindow | null) | null = null;
function assertSender(event: IpcMainInvokeEvent): WebContents {
  const expected = getPrimaryWindow?.();
  if (!expected || expected.isDestroyed() || event.sender !== expected.webContents ||
      event.senderFrame !== expected.webContents.mainFrame) {
    throw studioError("PERMISSION_DENIED", "IPC sender is not Vocalizer's main application frame.");
  }
  let allowed = false;
  try {
    const frame = new URL(event.senderFrame.url);
    allowed = expected.webContents.getURL().startsWith("las://")
      ? frame.protocol === "las:" && frame.hostname === "renderer"
      : frame.protocol === "http:" && frame.hostname === "localhost" && frame.port === "3000";
  } catch {
    // Reject malformed and untrusted origins.
  }
  if (!allowed) throw studioError("PERMISSION_DENIED", "IPC operation rejected for an untrusted application origin.");
  return event.sender;
}

/** The only checkpoint allowed in the initial local-model preview. */
const VERIFIED_MDX_NAME = "UVR-MDX-NET-Inst_HQ_5.onnx";
const VERIFIED_MDX_SHA256 = "811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000";
const VERIFIED_MDX_SIZE = 59074342;
const VERIFIED_DEMUCS_NAME = "955717e8-8726e21a.th";
const VERIFIED_DEMUCS_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4";

async function verifyLocalModel(modelId: string, modelPath: string, architecture: string): Promise<void> {
  const approved = architecture === "mdx-net"
    ? { name: VERIFIED_MDX_NAME, sha256: VERIFIED_MDX_SHA256, size: VERIFIED_MDX_SIZE }
    : architecture === "demucs"
      ? { name: VERIFIED_DEMUCS_NAME, sha256: VERIFIED_DEMUCS_SHA256, size: null }
      : null;
  if (!approved) {
    throw studioError("ARCHITECTURE_UNSUPPORTED", "This inference architecture is not enabled in the packaged CPU worker.");
  }
  if (!path.isAbsolute(modelPath) || path.basename(modelPath) !== approved.name || modelId !== approved.name) {
    throw studioError("MISSING_FILE", "Select the pinned local checkpoint with its exact filename.");
  }
  let size: number;
  try {
    const stat = await fs.promises.lstat(modelPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Not a regular checkpoint");
    size = stat.size;
  } catch {
    throw studioError("MISSING_FILE", "The selected checkpoint is missing, linked or unreadable.");
  }
  if (approved.size !== null && size !== approved.size) {
    throw studioError("MODEL_CORRUPTED", "The selected checkpoint does not match the approved size.");
  }
  const hash = createHash("sha256");
  try {
    for await (const block of fs.createReadStream(modelPath)) hash.update(block);
  } catch {
    throw studioError("MISSING_FILE", "Cannot read the selected checkpoint.");
  }
  if (hash.digest("hex") !== approved.sha256) {
    throw studioError("MODEL_CORRUPTED", "The model failed full SHA-256 verification.");
  }
}

// Only completed, validated inference results may be revealed or played.
const completedInferenceStems = new Map<string, Map<string, string>>();
// Pin the identity of user-relinked audio. An on-disk replacement must not
// silently become a different source after the user verified the original.
const relinkedStemStats = new Map<string, { dev: number; ino: number; size: number; mtimeMs: number }>();
const completedFfmpegOutputs = new Map<string, string>();
const stagedRecordings = new Map<string, string>();
const ALLOWED_STEMS = new Set(["Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other"]);

/** Packaged acceptance only: register a *synthetic* WAV fixture from main.
 * This is not an IPC endpoint or a renderer filesystem capability. Normal
 * application sessions cannot use this method.
 */
export async function registerSmokeStemForAcceptance(selectedPath: string): Promise<void> {
  if (!app.isPackaged || !process.argv.includes("--vocalizer-smoke-test")) {
    throw studioError("PERMISSION_DENIED", "Smoke fixture registration is disabled.");
  }
  const resolved = await fs.promises.realpath(selectedPath);
  const info = await fs.promises.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 100 ||
      path.extname(resolved).toLowerCase() !== ".wav") {
    throw studioError("INPUT_INVALID", "Smoke fixture is not a usable local WAV.");
  }
  completedInferenceStems.set("windows-smoke-media", new Map([["Vocals", resolved]]));
}

/** Playback is restricted to exact paths already verified by the main process.
 * This API is never exposed through the preload bridge. */
export async function resolveCompletedStemForPlayback(jobId: string, stem: string): Promise<string | null> {
  if (!ALLOWED_STEMS.has(stem)) return null;
  const registered = completedInferenceStems.get(jobId)?.get(stem);
  if (!registered) return null;
  try {
    const real = await fs.promises.realpath(registered);
    const stat = await fs.promises.stat(real);
    if (real !== registered || !stat.isFile()) return null;
    const pinned = relinkedStemStats.get(`${jobId}:${stem}`);
    if (pinned && (stat.dev !== pinned.dev || stat.ino !== pinned.ino ||
        stat.size !== pinned.size || stat.mtimeMs !== pinned.mtimeMs)) return null;
    if (![".wav", ".flac", ".mp3"].includes(path.extname(real).toLowerCase())) return null;
    return real;
  } catch {
    return null;
  }
}
/** Convert an opaque verified stem token to a real main-owned file path.
 * Renderer-supplied absolute paths are never needed for stem-backed lanes.
 * Every resolution checks that the completed stem still exists on disk. */
async function resolveNativeAudioInput(value: string): Promise<string> {
  let ref: ReturnType<typeof parseNativeStemInput>;
  try {
    ref = parseNativeStemInput(value);
  } catch {
    throw studioError("PERMISSION_DENIED", "Malformed stem source reference.");
  }
  if (!ref) return value;
  const approved = await resolveCompletedStemForPlayback(ref.jobId, ref.stem);
  if (!approved) {
    throw studioError("MISSING_FILE", "This stem is no longer registered or available. Rerun separation.");
  }
  return approved;
}

async function resolveNativeAudioInputs(op: FfmpegOp): Promise<FfmpegOp> {
  switch (op.kind) {
    case "trim":
    case "pitch":
    case "convert":
      return { ...op, inputPath: await resolveNativeAudioInput(op.inputPath) };
    case "join":
      return { ...op, inputPaths: await Promise.all(op.inputPaths.map(resolveNativeAudioInput)) };
    case "mix":
      return { ...op,
        instrumentalPath: await resolveNativeAudioInput(op.instrumentalPath),
        vocalPath: await resolveNativeAudioInput(op.vocalPath) };
    case "multitrack":
      return { ...op,
        lanes: await Promise.all(op.lanes.map(async lane => ({
          ...lane, inputPath: await resolveNativeAudioInput(lane.inputPath),
        }))) };
  }
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  getPrimaryWindow = getMainWindow;
  /* --------------------------------- dialogs -------------------------------- */
  ipcMain.handle(IPC.DIALOG_OPEN_FILES, async (event, raw) => {
    assertSender(event);
    const req = openFilesRequestSchema.parse(raw ?? {});
    const result = await dialog.showOpenDialog({
      title: "Import audio",
      properties: req.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: req.filters ?? [
        { name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "webm", "aiff", "wma"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_SAVE_FILE, async (event, raw) => {
    assertSender(event);
    const req = saveFileRequestSchema.parse(raw ?? {});
    const result = await dialog.showSaveDialog({
      title: "Save audio",
      defaultPath: req.defaultName,
      filters: req.filters ?? [
        { name: "WAV", extensions: ["wav"] },
        { name: "MP3", extensions: ["mp3"] },
        { name: "FLAC", extensions: ["flac"] },
      ],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle(IPC.DIALOG_OPEN_DIRECTORY, async (event, raw) => {
    assertSender(event);
    const req = openDirectoryRequestSchema.parse(raw ?? {});
    const result = await dialog.showOpenDialog({
      title: req.title ?? "Choose directory",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  /* --------------------------------- ffprobe -------------------------------- */
  ipcMain.handle(IPC.FFPROBE_METADATA, async (event, raw) => {
    assertSender(event);
    const req = ffprobeRequestSchema.parse(raw);
    // Stem-backed tracks carry an opaque token, never a renderer-visible path.
    // Resolve only registered completed stems before letting FFprobe inspect it.
    return probeFile(await resolveNativeAudioInput(req.path));
  });

  /* ---------------------------- recorded audio ----------------------------- */
  ipcMain.handle(IPC.RECORDING_STAGE, async (event, raw) => {
    assertSender(event);
    const req = recordingStageSchema.parse(raw);
    if (stagedRecordings.has(req.jobId)) {
      throw studioError("INPUT_INVALID", "A recording is already staged for this job.");
    }
    const tempPath = await stageRecordingBytes(app.getPath("userData"), req.jobId, req.format, req.bytes);
    stagedRecordings.set(req.jobId, tempPath);
    return { staged: true };
  });

  ipcMain.handle(IPC.RECORDING_DISCARD, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw);
    const file = stagedRecordings.get(req.jobId);
    if (!file) return { discarded: false };
    stagedRecordings.delete(req.jobId);
    await discardRecordingFile(file);
    return { discarded: true };
  });

  /* --------------------------------- ffmpeg --------------------------------- */
  ipcMain.handle(IPC.FFMPEG_RUN, async (event, raw) => {
    const sender = assertSender(event);
    const request = ffmpegOpSchema.parse(raw);
    const stagedFile = request.kind === "mix" && request.vocalPath === "__recording__"
      ? stagedRecordings.get(request.jobId)
      : null;
    if (request.kind === "mix" && request.vocalPath === "__recording__" && !stagedFile) {
      throw studioError("MISSING_FILE", "The microphone recording is not staged for this job.");
    }
    const stagedOp = stagedFile && request.kind === "mix" ? { ...request, vocalPath: stagedFile } : request;
    const op = await resolveNativeAudioInputs(stagedOp);
    const emit = (p: FfmpegProgress) => {
      if (!sender.isDestroyed()) sender.send(IPC.FFMPEG_PROGRESS, p);
    };
    try {
      const result = await runFfmpeg(op, emit);
      if (!result.verified) {
        throw studioError("ENCODE_FAILED", "FFmpeg output has not been verified.");
      }
      const outputPath = await fs.promises.realpath(result.outputPath);
      if (!(await fs.promises.stat(outputPath)).isFile()) {
        throw studioError("OUTPUT_EMPTY", "FFmpeg output is no longer a valid file.");
      }
      completedFfmpegOutputs.set(op.jobId, outputPath);
      if (completedFfmpegOutputs.size > 50) {
        const oldest = completedFfmpegOutputs.keys().next().value;
        if (oldest) completedFfmpegOutputs.delete(oldest);
      }
      return result;
    } catch (err) {
      throw toMainErrorPayload(err);
    } finally {
      // The native operation has finished. Clear its private source even
      // if the renderer failed before requesting cleanup.
      if (stagedFile) {
        stagedRecordings.delete(request.jobId);
        await discardRecordingFile(stagedFile);
      }
    }
  });

  ipcMain.handle(IPC.FFMPEG_CANCEL, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw);
    return { cancelled: cancelJob(req.jobId) };
  });

  ipcMain.handle(IPC.FFMPEG_REVEAL_OUTPUT, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw);
    const registered = completedFfmpegOutputs.get(req.jobId);
    if (!registered) throw studioError("PERMISSION_DENIED", "No verified export is registered for this job.");
    try {
      const real = await fs.promises.realpath(registered);
      if (real !== registered || !(await fs.promises.stat(real)).isFile()) {
        throw new Error("Export is missing or moved.");
      }
      shell.showItemInFolder(real);
      return { revealed: true };
    } catch {
      throw studioError("MISSING_FILE", "The completed export no longer exists on disk.");
    }
  });

  /* --------------------------------- settings ------------------------------- */
  ipcMain.handle(IPC.SETTINGS_GET, async (event) => {
    assertSender(event);
    return getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (event, raw) => {
    assertSender(event);
    const parsed = nativeSettingsSchema.partial().safeParse(raw ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid settings patch: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
    }
    return setSettings(parsed.data as Partial<NativeSettings>);
  });

  /* ------------------------------- inference ------------------------------- */
  ipcMain.handle(IPC.INFERENCE_STATUS, async (event) => {
    assertSender(event);
    const runtimes = detectedRuntimes();
    return {
      workerAvailable: isWorkerAvailable(),
      runtimes,
      devices: ["cpu" as const, ...(runtimes.includes("cuda") ? (["cuda"] as const) : []), ...(runtimes.includes("directml") ? (["directml"] as const) : [])],
      defaultModelInstalled: false, // updated when a bundled default ships
    };
  });

  ipcMain.handle(IPC.INFERENCE_SEPARATE, async (event, raw) => {
    const sender = assertSender(event);
    const req = inferenceSeparateRequestSchema.parse(raw);
    let scratch: string | null = null;
    try {
      const expectedStems: string[] = req.architecture === "demucs"
        ? ["Vocals", "Drums", "Bass", "Other"]
        : ["Vocals", "Instrumental"];
      if (req.requestedStems.length !== expectedStems.length ||
          !expectedStems.every(stem => new Set<string>(req.requestedStems).has(stem))) {
        throw studioError("ARCHITECTURE_UNSUPPORTED", "The model requires its complete supported stem set.");
      }
      if (!["auto", "cpu"].includes(req.device)) {
        throw studioError("ARCHITECTURE_UNSUPPORTED", "Only local CPU inference is supported.");
      }
      await verifyLocalModel(req.modelId, req.modelPath, req.architecture);
      const root = inferenceScratchBase(app.getPath("userData"));
      await fs.promises.mkdir(root, { recursive: true });
      scratch = await fs.promises.mkdtemp(path.join(root, "job-"));
      const result = await runSeparation({
        jobId: req.jobId,
        modelId: req.modelId,
        modelPath: req.modelPath,
        architecture: req.architecture,
        configPath: req.configPath,
        inputPath: req.inputPath,
        outputDir: scratch,
        requestedStems: req.requestedStems as string[],
        outputFormat: req.outputFormat,
        mp3Bitrate: req.mp3Bitrate,
        device: req.device,
        profile: req.profile,
        onProgress: (p) => {
          if (!sender.isDestroyed()) {
            const prog: InferenceProgress = { jobId: req.jobId, progress: p.progress, stage: p.stage };
            sender.send(IPC.INFERENCE_PROGRESS, prog);
          }
        },
      });
      // The worker returns a `result` response; map it to the IPC result shape.
      if (result.type === "result") {
        const actualScratch = await fs.promises.realpath(scratch);
        const approved = new Map<string, string>();
        const expected = new Set(req.requestedStems);
        if (expected.size === 0 || result.stems.length !== expected.size) {
          throw studioError("INFERENCE_FAILED", "The worker did not return the expected stems.");
        }
        for (const item of result.stems) {
          if (!expected.has(item.stem) || approved.has(item.stem)) {
            throw studioError("INFERENCE_FAILED", "The worker returned an unexpected or duplicate stem.");
          }
          const resolved = await fs.promises.realpath(item.path);
          const relative = path.relative(actualScratch, resolved);
          const inside = Boolean(relative) && relative !== ".." &&
            !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
          if (!inside || ![".wav", ".flac", ".mp3"].includes(path.extname(resolved).toLowerCase()) ||
              !(await fs.promises.stat(resolved)).isFile()) {
            throw studioError("INFERENCE_FAILED", "Inference returned an output outside the approved folder or with an invalid format.");
          }
          approved.set(item.stem, resolved);
        }
        if (approved.size !== expected.size) {
          throw studioError("INFERENCE_FAILED", "The worker did not return one file for each requested stem.");
        }
        // Publish only after the complete stem set is verified. The Python worker never
        // has access to the user-selected destination and cannot erase files
        // already stored there when it is cancelled.
        const published = publishInferenceStems(result.stems, actualScratch, req.outputDir, req.jobId);
        const completed = new Map(published.map(item => [item.stem, item.path]));
        // A fresh inference result takes precedence over any prior user-relinked
        // session registration with the same job token.
        for (const stem of completed.keys()) relinkedStemStats.delete(`${req.jobId}:${stem}`);
        completedInferenceStems.set(req.jobId, completed);
        if (completedInferenceStems.size > 50) {
          const oldest = completedInferenceStems.keys().next().value;
          if (oldest) {
            for (const stem of completedInferenceStems.get(oldest)?.keys() ?? []) {
              relinkedStemStats.delete(`${oldest}:${stem}`);
            }
            completedInferenceStems.delete(oldest);
          }
        }
        const res: InferenceSeparateResult = {
          jobId: req.jobId,
          stems: result.stems.map(item => ({
            ...item,
            path: completed.get(item.stem)!,
          })),
          modelUsed: result.modelUsed,
          deviceUsed: result.deviceUsed,
          fallbackUsed: result.fallbackUsed,
        };
        return res;
      }
      throw toMainErrorPayload(studioError("INFERENCE_FAILED", "Worker returned an unexpected response."));
    } catch (err) {
      throw toMainErrorPayload(err);
    } finally {
      if (scratch) {
        // Interrupted/failed jobs never leave partial stems in user folders.
        try { await fs.promises.rm(scratch, { recursive: true, force: true }); }
        catch (error) { console.error("Could not remove private inference scratch:", error); }
      }
    }
  });

  ipcMain.handle(IPC.INFERENCE_CANCEL, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw ?? {});
    return { cancelled: cancelSeparation(req.jobId) };
  });

  // Only one decoder is allowed per main process to constrain background CPU
  // usage; starting a new track aborts an older waveform request.
  const waveformRequests = new WaveformRequestCoordinator();
  ipcMain.handle(IPC.INFERENCE_STEM_WAVEFORM, async (event, raw) => {
    assertSender(event);
    const req = inferenceWaveformRequestSchema.parse(raw);
    // Register BEFORE async authorization so slow source lookups and
    // outdated player cleanups cannot interfere with newer requests.
    const task = waveformRequests.start(req);
    try {
      const approved = await resolveCompletedStemForPlayback(req.jobId, req.stem);
      if (task.controller.signal.aborted) throw studioError("CANCELLED", "Superseded waveform request.");
      if (!approved) throw studioError("MISSING_FILE", "Verified audio stem is unavailable for waveform generation.");
      const source = await identifyNativeWaveformSource(approved);
      if (task.controller.signal.aborted) throw studioError("CANCELLED");
      const storage = path.join(cacheDir(), "native-waveforms-v1");
      const cached = await readNativeWaveformCache(storage, source);
      if (task.controller.signal.aborted) throw studioError("CANCELLED");
      if (cached) {
        const current = await identifyNativeWaveformSource(approved);
        const registered = await resolveCompletedStemForPlayback(req.jobId, req.stem);
        // A cached result can only be returned by its still-active owner,
        // even when cancellation occurs during the last filesystem awaits.
        if (task.controller.signal.aborted) throw studioError("CANCELLED");
        if (nativeWaveformFingerprint(current).equals(nativeWaveformFingerprint(source)) &&
            registered === approved) {
          return { ...cached, cacheHit: true };
        }
        throw studioError("CANCELLED", "Native audio changed while reading cached peaks.");
      }
      const meta = await probeFile(approved, task.controller.signal);
      if (task.controller.signal.aborted) throw studioError("CANCELLED");
      if (!Number.isFinite(meta.duration) || meta.duration <= 0 || meta.duration > 4 * 3600) {
        throw studioError("INPUT_INVALID", "Waveform duration must be under four hours.");
      }
      const response = await generateNativeStemWaveform(approved, meta.duration, task.controller.signal);
      if (task.controller.signal.aborted ||
          await resolveCompletedStemForPlayback(req.jobId, req.stem) !== approved) {
        throw studioError("CANCELLED", "This source changed while generating waveform peaks.");
      }
      const after = await identifyNativeWaveformSource(approved);
      if (task.controller.signal.aborted) throw studioError("CANCELLED");
      if (!nativeWaveformFingerprint(source).equals(nativeWaveformFingerprint(after))) {
        throw studioError("CANCELLED", "Native audio was modified during waveform generation.");
      }
      // Cache failures are best-effort: successful waveform generation must
      // never fail merely because the disk is full or cache is read-only.
      try {
        await writeNativeWaveformCache(storage, source, response);
      } catch { /* regeneration remains available on next project open */ }
      if (task.controller.signal.aborted) throw studioError("CANCELLED");
      return { ...response, cacheHit: false };
    } finally {
      waveformRequests.finish(task);
    }
  });

  ipcMain.handle(IPC.INFERENCE_CANCEL_STEM_WAVEFORM, async (event, raw) => {
    assertSender(event);
    const req = inferenceWaveformRequestSchema.parse(raw);
    return { cancelled: waveformRequests.cancel(req) };
  });

  ipcMain.handle(IPC.INFERENCE_PROBE_STEM, async (event, raw) => {
    assertSender(event);
    const req = revealInferenceStemSchema.parse(raw);
    const approved = await resolveCompletedStemForPlayback(req.jobId, req.stem);
    if (!approved) throw studioError("MISSING_FILE", "Verified stem output is unavailable.");
    const metadata = await probeFile(approved);
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.sizeBytes <= 0 ||
        !metadata.channels || !metadata.sampleRate) {
      throw studioError("DECODE_FAILED", "Native stem metadata could not be verified.");
    }
    return metadata;
  });

  /** Select on disk through an operating-system dialog; never accept paths
   * from project JSON or renderer IPC. Large files stay file-backed. */
  ipcMain.handle(IPC.INFERENCE_RELINK_STEMS, async (event, raw) => {
    assertSender(event);
    const req = nativeStemRelinkRequestSchema.parse(raw);
    const wanted = new Map<string, typeof req.expected>();
    for (const item of req.expected) {
      if (!parsePublishedStemFilename(item.name)) continue;
      const entries = wanted.get(item.name) ?? [];
      entries.push(item);
      wanted.set(item.name, entries);
    }
    if (!wanted.size) {
      return { cancelled: false, rejected: 0, files: [] };
    }
    const selected = await dialog.showOpenDialog({
      title: "Relink saved Vocalizer stems",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Published stems", extensions: ["wav", "flac", "mp3"] }],
    });
    if (selected.canceled || !selected.filePaths.length) {
      return { cancelled: true, rejected: 0, files: [] };
    }
    if (selected.filePaths.length > 128) {
      throw studioError("INPUT_INVALID", "Choose at most 128 saved stems per relink operation.");
    }

    const files: Array<{
      name: string;
      jobId: string;
      stem: "Vocals" | "Instrumental" | "Drums" | "Bass" | "Guitar" | "Piano" | "Other";
      meta: Awaited<ReturnType<typeof probeFile>>;
    }> = [];
    let rejected = 0;
    for (const chosenPath of selected.filePaths) {
      const name = path.basename(chosenPath);
      const ref = parsePublishedStemFilename(name);
      const candidates = wanted.get(name);
      if (!ref || !candidates || candidates.length !== 1) { rejected++; continue; }
      try {
        const before = await fs.promises.lstat(chosenPath);
        if (!before.isFile() || before.isSymbolicLink() || before.size <= 0) {
          rejected++; continue;
        }
        const real = await fs.promises.realpath(chosenPath);
        const meta = await probeFile(real);
        const after = await fs.promises.lstat(chosenPath);
        if (!after.isFile() || after.isSymbolicLink() ||
            before.dev !== after.dev || before.ino !== after.ino ||
            before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
            meta.sizeBytes !== after.size || !meta.sampleRate || !meta.channels ||
            !doesRelinkedStemMatch(candidates[0], {
              name, size: meta.sizeBytes, duration: meta.duration,
            })) { rejected++; continue; }
        const existing = completedInferenceStems.get(ref.jobId)?.get(ref.stem);
        if (existing && existing !== real &&
            await resolveCompletedStemForPlayback(ref.jobId, ref.stem)) {
          rejected++; continue;
        }
        const job = completedInferenceStems.get(ref.jobId) ?? new Map<string, string>();
        job.set(ref.stem, real);
        completedInferenceStems.delete(ref.jobId);
        completedInferenceStems.set(ref.jobId, job);
        relinkedStemStats.set(`${ref.jobId}:${ref.stem}`, {
          dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs,
        });
        files.push({ name, jobId: ref.jobId, stem: ref.stem, meta });
      } catch {
        // An unreadable or corrupted selected file must not unblock mixdown.
        rejected++;
      }
    }
    while (completedInferenceStems.size > 50) {
      const oldest = completedInferenceStems.keys().next().value;
      if (!oldest) break;
      for (const stem of completedInferenceStems.get(oldest)?.keys() ?? []) {
        relinkedStemStats.delete(`${oldest}:${stem}`);
      }
      completedInferenceStems.delete(oldest);
    }
    return { cancelled: false, rejected, files };
  });

  ipcMain.handle(IPC.INFERENCE_REVEAL_STEM, async (event, raw) => {
    assertSender(event);
    const req = revealInferenceStemSchema.parse(raw);
    const approved = completedInferenceStems.get(req.jobId)?.get(req.stem);
    if (!approved) throw studioError("PERMISSION_DENIED", "No completed stem exists for this job.");
    const real = await fs.promises.realpath(approved);
    const stat = await fs.promises.stat(real);
    if (real !== approved || !stat.isFile()) {
      throw studioError("PERMISSION_DENIED", "The verified output file is no longer available.");
    }
    shell.showItemInFolder(real);
    return { revealed: true };
  });

  /* --------------------------------- system --------------------------------- */
  ipcMain.handle(IPC.APP_RESOLVE_PATH, async (event, raw) => {
    assertSender(event);
    const req = resolvePathRequestSchema.parse(raw);
    return resolvePathKind(req.kind);
  });

  ipcMain.handle(IPC.SYSTEM_INFO, async (event) => {
    assertSender(event);
    const ffmpegPath = getFfmpegPath();
    const ffprobePath = getFfprobePath();
    const ffmpegVersion = ffmpegPath ? await getFfmpegVersion(ffmpegPath) : null;
    const rubberBand = ffmpegVersion ? /rubberband|rubber/i.test(ffmpegVersion) : false;
    let freeBytes: number | null = null;
    try {
      const userData = resolvePathKind("userData");
      if (typeof fs.statfsSync === "function") {
        const s = fs.statfsSync(userData);
        freeBytes = s.bfree * s.bsize;
      }
    } catch {
      /* statfs may be unavailable */
    }
    return {
      platform: process.platform,
      arch: process.arch,
      osVersion: `${os.type()} ${os.release()}`,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCores: os.cpus().length,
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      userDataPath: resolvePathKind("userData"),
      resourcesPath: process.resourcesPath,
      ffmpegPath: ffmpegPath ?? "not bundled",
      ffprobePath: ffprobePath ?? "not bundled",
      ffmpegVersion,
      ffmpegAvailable: !!ffmpegPath,
      rubberBandAvailable: rubberBand,
      appDataFreeBytes: freeBytes,
    };
  });
}

async function getFfmpegVersion(ffmpeg: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ["-version"], { shell: false, windowsHide: true });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(out.split("\n")[0]));
  });
}
