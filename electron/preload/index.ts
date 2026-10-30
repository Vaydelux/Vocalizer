/**
 * Secure preload — exposes a strictly typed, validated `window.studio` surface
 * via contextBridge. No raw `ipcRenderer`, `fs`, `child_process`, or
 * `require` ever leaks to the renderer. Every method maps to one validated IPC
 * handler on the main side.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "../shared/ipc";
import type { StudioNativeApi } from "../shared/ipc";

const api: StudioNativeApi = {
  isNative: true,

  // Resolve the real filesystem path of a renderer <input type=file> selection.
  // Uses the Electron webUtils API (the deprecated File.path is avoided).
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  openFiles: (req) => ipcRenderer.invoke(IPC.DIALOG_OPEN_FILES, req ?? {}),
  saveFile: (req) => ipcRenderer.invoke(IPC.DIALOG_SAVE_FILE, req ?? {}),
  openDirectory: (req) => ipcRenderer.invoke(IPC.DIALOG_OPEN_DIRECTORY, req ?? {}),

  probeMetadata: (req) => ipcRenderer.invoke(IPC.FFPROBE_METADATA, req),
  runFfmpeg: (op) => ipcRenderer.invoke(IPC.FFMPEG_RUN, op),
  cancelFfmpeg: (req) => ipcRenderer.invoke(IPC.FFMPEG_CANCEL, req),
  revealFfmpegOutput: (req) => ipcRenderer.invoke(IPC.FFMPEG_REVEAL_OUTPUT, req),

  onFfmpegProgress: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on(IPC.FFMPEG_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.FFMPEG_PROGRESS, handler);
  },

  // Inference (AI separation) — honestly unavailable until a worker is bundled.
  inferenceStatus: () => ipcRenderer.invoke(IPC.INFERENCE_STATUS),
  runInference: (req) => ipcRenderer.invoke(IPC.INFERENCE_SEPARATE, req),
  cancelInference: (req) => ipcRenderer.invoke(IPC.INFERENCE_CANCEL, req),
  revealInferenceStem: (req) => ipcRenderer.invoke(IPC.INFERENCE_REVEAL_STEM, req),
  onInferenceProgress: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on(IPC.INFERENCE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.INFERENCE_PROGRESS, handler);
  },

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch ?? {}),

  resolvePath: (req) => ipcRenderer.invoke(IPC.APP_RESOLVE_PATH, req),
  systemInfo: () => ipcRenderer.invoke(IPC.SYSTEM_INFO),
};

contextBridge.exposeInMainWorld("studio", api);
