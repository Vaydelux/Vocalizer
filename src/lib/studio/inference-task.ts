"use client";

/**
 * AI separation inference task. When running inside Electron with a bundled
 * inference worker, this calls `window.studio.runInference` to perform REAL
 * neural-network separation through the validated IPC bridge. When no worker is
 * bundled (the current state of this environment), the job fails honestly with
 * a typed `CAPABILITY_UNAVAILABLE` error — it never fabricates stems.
 *
 * The task integrates into the existing processing queue (no competing job system).
 */

import type { JobCtx, JobResultFile, JobTask } from "./types";
import type { AudioTrack, ModelStem, ExportFormat, Mp3Bitrate } from "./types";
import { native, isNative } from "./native";
import { studioError, toStudioError } from "./errors";
import { resolveModelForOperation } from "./registry";
import { useModels } from "./store-models";
import { baseName, sanitizeFileName, timestampSlug } from "./format";

export interface SeparationRequest {
  track: AudioTrack;
  /** Requested stems (e.g. ["Vocals","Instrumental"] for the Remover). */
  requestedStems: ModelStem[];
  /** Preferred model id (null → use the bundled default). */
  preferredModelId: string | null;
  device: "auto" | "cpu" | "cuda" | "directml";
  outputFormat: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeInferenceTask(req: SeparationRequest): JobTask {
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    // 1. Must be native (Electron) — no in-browser inference.
    if (!isNative()) {
      throw studioError(
        "CAPABILITY_UNAVAILABLE",
        "AI separation requires the desktop runtime. It cannot run in the web preview and is never faked."
      );
    }
    const api = native()!;

    // 2. Resolve the model via the fallback resolver (stem-mismatch rejection).
    const models = useModels.getState();
    const resolution = await resolveModelForOperation(
      { builtin: models.builtin, userModels: models.userModels },
      {
        operation: req.requestedStems.length > 2 ? "stem-separation" : "vocal-removal",
        requiredStems: req.requestedStems,
        preferredModelId: req.preferredModelId,
        device: req.device === "auto" ? null : (req.device as "cpu" | "cuda" | "directml" | null),
      }
    );
    if (resolution.status !== "ready") {
      // Honest failure: the resolver returns the specific reason. This is the
      // critical stem-mismatch rejection (4-stem request vs 2-stem default →
      // NOT silently substituted).
      const reason = "reason" in resolution ? resolution.reason : "No compatible model.";
      throw studioError("MODEL_UNAVAILABLE", `Separation unavailable: ${reason}`);
    }

    // 3. Resolve real filesystem paths.
    const inputPath = api.getPathForFile(req.track.file);
    const outputDir = await api.openDirectory({ title: "Choose output directory for stems" });
    if (!outputDir) throw studioError("CANCELLED", "No output directory selected.");

    const fmt = req.outputFormat === "wav16" ? "wav" : req.outputFormat === "wav24" ? "wav24" : req.outputFormat;
    ctx.log(`Inference: ${resolution.modelId} on ${resolution.device} → ${outputDir}`);

    // 4. Subscribe to progress, then run.
    const unsub = api.onInferenceProgress((p) => {
      if (p.jobId === ctx.jobId) ctx.reportProgress(p.progress, p.stage);
    });
    try {
      const result = await api.runInference({
        jobId: ctx.jobId,
        modelId: resolution.modelId,
        modelPath: resolution.modelId, // the worker resolves the model path from the registry/manifest
        architecture: "mdx-net", // resolved from the model manifest in a real build
        inputPath,
        outputDir,
        requestedStems: req.requestedStems,
        outputFormat: fmt,
        device: req.device,
      });
      ctx.log(
        `Separation complete: ${result.stems.length} stem(s), model=${result.modelUsed}, device=${result.deviceUsed}, fallback=${result.fallbackUsed}.`
      );
      // Return a manifest of the produced stems as the job result (the queue
      // records real output paths; downloads/reveals happen per-stem from the UI).
      const manifest = {
        jobId: ctx.jobId,
        modelUsed: result.modelUsed,
        deviceUsed: result.deviceUsed,
        fallbackUsed: result.fallbackUsed,
        stems: result.stems,
        createdAt: Date.now(),
      };
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const name = `${sanitizeFileName(baseName(req.track.name))}_separation_${timestampSlug()}.json`;
      return {
        name,
        size: blob.size,
        url: URL.createObjectURL(blob),
        mime: "application/json",
      };
    } catch (err) {
      throw toStudioError(err);
    } finally {
      unsub();
    }
  };
}
