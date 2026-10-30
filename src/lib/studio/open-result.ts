"use client";

/** Open a completed job result without treating Windows paths as browser URLs. */
import { toast } from "sonner";
import type { Job } from "./types";
import { native } from "./native";
import { downloadResult } from "./download";

export async function openJobResult(job: Job): Promise<void> {
  const result = job.result;
  if (!result || job.state !== "completed") return;
  if (!result.nativePath) {
    downloadResult(result.url, result.name);
    return;
  }
  const api = native();
  if (!api) {
    toast.error("The desktop runtime is required to reveal this export.");
    return;
  }
  try {
    const res = await api.revealFfmpegOutput({ jobId: job.id });
    if (!res.revealed) throw new Error("Export is not available.");
  } catch (error) {
    toast.error("Cannot find the completed export.", {
      description: error instanceof Error ? error.message : "The saved file may have been moved or deleted.",
    });
  }
}
