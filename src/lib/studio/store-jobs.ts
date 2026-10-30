"use client";

/**
 * Processing queue — the common job-management layer.
 *
 * States: queued → preparing → running → (cancelling) → completed | failed | cancelled
 * - Cancellation via AbortController; child stages check the signal.
 * - Progress comes from real loop fractions or is indeterminate (null). Never faked.
 * - Outputs are verified (non-empty) before a job may report "completed".
 * - Concurrency is configurable via settings.
 */

import { create } from "zustand";
import { toast } from "sonner";
import type { Job, JobCtx, JobResultFile, JobTask, JobType } from "./types";
import { toStudioError, studioError } from "./errors";
import { formatBytes } from "./format";
import { useSettings } from "./store-settings";

const MAX_LOGS = 100;
const MAX_JOBS = 60;

interface JobStore {
  jobs: Job[];
  enqueue: (type: JobType, label: string, task: JobTask) => string;
  cancel: (id: string) => void;
  clearFinished: () => void;
  removeJob: (id: string) => void;
}

const tasks = new Map<string, JobTask>();
const controllers = new Map<string, AbortController>();
const queueOrder: string[] = [];
let running = 0;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function patchJob(id: string, patch: Partial<Job>): void {
  useJobs.setState((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }));
}

function appendLog(id: string, msg: string): void {
  useJobs.setState((s) => ({
    jobs: s.jobs.map((j) => {
      if (j.id !== id) return j;
      const logs = [...j.logs, { t: Date.now(), msg }];
      return { ...j, logs: logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs };
    }),
  }));
}

function scheduleNext(): void {
  const limit = useSettings.getState().concurrency;
  while (running < limit) {
    const nextId = queueOrder.shift();
    if (!nextId) break;
    const job = useJobs.getState().jobs.find((j) => j.id === nextId);
    if (!job || job.state !== "queued") continue;
    running += 1;
    void runJob(nextId, job.label);
  }
}

async function runJob(id: string, label: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) {
    running -= 1;
    scheduleNext();
    return;
  }
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  patchJob(id, { state: "preparing", startedAt: Date.now(), stage: "Preparing" });
  appendLog(id, "Job accepted by the processing queue.");

  const ctx: JobCtx = {
    jobId: id,
    signal: ctrl.signal,
    reportProgress: (progress, stage) => {
      patchJob(id, { progress, stage: stage ?? null });
    },
    log: (msg) => appendLog(id, msg),
  };

  try {
    patchJob(id, { state: "running" });
    const result = await task(ctx);
    if (ctx.signal.aborted) {
      patchJob(id, {
        state: "cancelled",
        endedAt: Date.now(),
        stage: "Cancelled",
        error: { code: "CANCELLED", message: "Cancelled by user." },
      });
      appendLog(id, "Aborted — output discarded, nothing reported as completed.");
    } else if (!result || result.size <= 0) {
      throw toStudioError(new Error("Job produced an empty result."));
    } else {
      patchJob(id, {
        state: "completed",
        endedAt: Date.now(),
        progress: 1,
        stage: "Completed",
        result,
        error: null,
      });
      appendLog(id, `Output verified: ${result.name} (${formatBytes(result.size)}).`);
      toast.success(`${label} — completed`, {
        description: `${result.name} · ${formatBytes(result.size)}`,
      });
    }
  } catch (err) {
    // An explicit AbortSignal always wins over a late worker rejection.
    // Electron IPC can stringify worker errors, so do not mark user-cancelled
    // jobs as FAILED merely because IPC returned an opaque error object.
    const e = ctrl.signal.aborted ? studioError("CANCELLED") : toStudioError(err);
    if (e.code === "CANCELLED") {
      patchJob(id, {
        state: "cancelled",
        endedAt: Date.now(),
        stage: "Cancelled",
        error: e,
      });
      appendLog(id, "Cancelled.");
    } else {
      patchJob(id, {
        state: "failed",
        endedAt: Date.now(),
        stage: "Failed",
        error: e,
      });
      appendLog(id, `Failed [${e.code}]: ${e.message}${e.detail ? ` — ${e.detail}` : ""}`);
      toast.error(`${label} — failed [${e.code}]`, { description: e.message });
    }
  } finally {
    tasks.delete(id);
    controllers.delete(id);
    running -= 1;
    scheduleNext();
  }
}

export const useJobs = create<JobStore>((set, get) => ({
  jobs: [],
  enqueue: (type, label, task) => {
    const id = uuid();
    tasks.set(id, task);
    const job: Job = {
      id,
      type,
      label,
      state: "queued",
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      progress: null,
      stage: null,
      logs: [],
      error: null,
      result: null,
    };
    set((s) => ({
      jobs: [...s.jobs, job].slice(Math.max(0, s.jobs.length + 1 - MAX_JOBS)),
    }));
    queueOrder.push(id);
    scheduleNext();
    return id;
  },
  cancel: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.state === "queued") {
      const idx = queueOrder.indexOf(id);
      if (idx >= 0) queueOrder.splice(idx, 1);
      patchJob(id, {
        state: "cancelled",
        endedAt: Date.now(),
        stage: "Cancelled",
        error: { code: "CANCELLED", message: "Cancelled before it started." },
      });
      tasks.delete(id);
    } else if (job.state === "preparing" || job.state === "running") {
      patchJob(id, { state: "cancelling", stage: "Cancelling…" });
      controllers.get(id)?.abort();
    }
  },
  clearFinished: () => {
    set((s) => ({
      jobs: s.jobs.filter((j) => {
        if (["completed", "failed", "cancelled"].includes(j.state)) {
          // Temp-file cleanup: revoke the finalized output's object URL.
          if (j.result?.url) URL.revokeObjectURL(j.result.url);
          return false;
        }
        return true;
      }),
    }));
  },
  removeJob: (id) => {
    if (controllers.has(id)) return; // cannot remove active jobs
    tasks.delete(id);
    set((s) => ({
      jobs: s.jobs.filter((j) => {
        if (j.id === id && j.result?.url) URL.revokeObjectURL(j.result.url);
        return j.id !== id;
      }),
    }));
  },
}));

export function activeJobCount(): number {
  return useJobs.getState().jobs.filter((j) =>
    ["queued", "preparing", "running", "cancelling"].includes(j.state)
  ).length;
}

export type { JobResultFile };
