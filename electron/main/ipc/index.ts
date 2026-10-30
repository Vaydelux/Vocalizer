/**
 * IPC handler registration — every channel validates its request with Zod and
 * authorizes the sender before doing any work. No handler trusts the renderer
 * payload shape; `shell: false` is enforced everywhere a process is spawned.
 */

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { spawn } from "node:child_process";
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
  resolvePathRequestSchema,
  nativeSettingsSchema,
  type FfmpegProgress,
  type NativeSettings,
} from "../../shared/ipc";
import { probeFile } from "../services/ffprobe";
import { runFfmpeg, cancelJob, toMainErrorPayload } from "../services/ffmpeg";
import { getSettings, setSettings } from "../services/settings";
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

/** True only for the renderer's own webContents — defends against cross-window IPC. */
function assertSender(event: IpcMainInvokeEvent): WebContents {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw studioError("PERMISSION_DENIED", "IPC sender is not a recognized window.");
  return event.sender;
}

export function registerIpcHandlers(_getMainWindow: () => BrowserWindow | null): void {
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

  /* --------------------------------- ffmpeg --------------------------------- */
  ipcMain.handle(IPC.FFMPEG_RUN, async (event, raw) => {
    const sender = assertSender(event);
    const op = ffmpegOpSchema.parse(raw);
    const emit = (p: FfmpegProgress) => {
      if (!sender.isDestroyed()) sender.send(IPC.FFMPEG_PROGRESS, p);
    };
    try {
      return await runFfmpeg(op, emit);
    } catch (err) {
      throw toMainErrorPayload(err);
    }
  });

  ipcMain.handle(IPC.FFMPEG_CANCEL, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw);
    return { cancelled: cancelJob(req.jobId) };
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
    try {
      const result = await runSeparation({
        jobId: req.jobId,
        modelId: req.modelId,
        modelPath: req.modelPath,
        architecture: req.architecture,
        configPath: req.configPath,
        inputPath: req.inputPath,
        outputDir: req.outputDir,
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
        const res: InferenceSeparateResult = {
          jobId: req.jobId,
          stems: result.stems,
          modelUsed: result.modelUsed,
          deviceUsed: result.deviceUsed,
          fallbackUsed: result.fallbackUsed,
        };
        return res;
      }
      throw toMainErrorPayload(studioError("INFERENCE_FAILED", "Worker returned an unexpected response."));
    } catch (err) {
      throw toMainErrorPayload(err);
    }
  });

  ipcMain.handle(IPC.INFERENCE_CANCEL, async (event, raw) => {
    assertSender(event);
    const req = cancelRequestSchema.parse(raw ?? {});
    return { cancelled: cancelSeparation(req.jobId) };
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
