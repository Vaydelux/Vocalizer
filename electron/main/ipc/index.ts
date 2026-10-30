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
  resolvePathRequestSchema,
  nativeSettingsSchema,
  type FfmpegProgress,
  type NativeSettings,
} from "../../shared/ipc";
import { probeFile } from "../services/ffprobe";
import { runFfmpeg, cancelJob, toMainErrorPayload } from "../services/ffmpeg";
import { getSettings, setSettings } from "../services/settings";
import { stageRecordingBytes, discardRecordingFile } from "../services/recording-staging";
import { inferenceScratchBase, publishInferenceStems } from "../services/inference-outputs";
import { getFfmpegPath, getFfprobePath, resolvePathKind } from "../services/paths";
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

async function verifyLocalMdxModel(modelId: string, modelPath: string, architecture: string): Promise<void> {
  if (architecture !== "mdx-net" || modelId !== VERIFIED_MDX_NAME) {
    throw studioError("ARCHITECTURE_UNSUPPORTED", "Only the verified MDX-Net HQ 5 model is available for local testing.");
  }
  if (!path.isAbsolute(modelPath) || path.basename(modelPath) !== VERIFIED_MDX_NAME) {
    throw studioError("MISSING_FILE", "Select the exact local ONNX checkpoint rather than a model identifier.");
  }
  let size: number;
  try {
    const stat = await fs.promises.stat(modelPath);
    if (!stat.isFile()) throw new Error("Not a regular file");
    size = stat.size;
  } catch {
    throw studioError("MISSING_FILE", "The chosen model checkpoint is missing or unreadable.");
  }
  if (size !== VERIFIED_MDX_SIZE) {
    throw studioError("MODEL_CORRUPTED", "The selected model does not match the approved checkpoint size.");
  }
  const hash = createHash("sha256");
  try {
    for await (const block of fs.createReadStream(modelPath)) hash.update(block);
  } catch {
    throw studioError("MISSING_FILE", "Cannot read the selected model file.");
  }
  if (hash.digest("hex") !== VERIFIED_MDX_SHA256) {
    throw studioError("MODEL_CORRUPTED", "The selected checkpoint failed the SHA-256 integrity check.");
  }
}

// Only completed, validated inference results may be revealed or played.
const completedInferenceStems = new Map<string, Map<string, string>>();
const completedFfmpegOutputs = new Map<string, string>();
const stagedRecordings = new Map<string, string>();
const ALLOWED_STEMS = new Set(["Vocals", "Instrumental"]);

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
    if (![".wav", ".flac", ".mp3"].includes(path.extname(real).toLowerCase())) return null;
    return real;
  } catch {
    return null;
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
    return probeFile(req.path);
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
    const op = stagedFile && request.kind === "mix" ? { ...request, vocalPath: stagedFile } : request;
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
      await verifyLocalMdxModel(req.modelId, req.modelPath, req.architecture);
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
        device: req.device,
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
        if (expected.size !== 2 || !expected.has("Vocals") || !expected.has("Instrumental") ||
            result.stems.length !== expected.size) {
          throw studioError("INFERENCE_FAILED", "The worker did not return the two expected stems.");
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
        // Publish only after both files are verified. The Python worker never
        // has access to the user-selected destination and cannot erase files
        // already stored there when it is cancelled.
        const published = publishInferenceStems(result.stems, actualScratch, req.outputDir, req.jobId);
        const completed = new Map(published.map(item => [item.stem, item.path]));
        completedInferenceStems.set(req.jobId, completed);
        if (completedInferenceStems.size > 50) {
          const oldest = completedInferenceStems.keys().next().value;
          if (oldest) completedInferenceStems.delete(oldest);
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
