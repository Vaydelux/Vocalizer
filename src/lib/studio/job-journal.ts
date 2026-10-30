"use client";

/** Minimal durable job receipts. This is NOT resumable job execution or a saved
 * audio project: never persist File, Blob, object URLs or model contents. */
import type { Job, JobState, JobType } from "./types";

const KEY = "vocalizer.job-receipts.v1";
const CURRENT_SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID() : `session-${Date.now()}`;
const VALID_STATES = new Set<JobState>(["queued","preparing","running","cancelling","completed","failed","cancelled"]);
const VALID_TYPES = new Set<JobType>(["export","analysis","convert","inference"]);
const FINAL = new Set<JobState>(["completed","failed","cancelled"]);

export interface JobReceipt {
  id: string;
  session: string;
  label: string;
  type: JobType;
  state: JobState | "interrupted";
  createdAt: number;
  endedAt: number | null;
}

function defaultStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readJobReceipts(storage: Storage | null = defaultStorage()): JobReceipt[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is JobReceipt =>
      r && typeof r.id === "string" && r.id.length <= 80 &&
      typeof r.session === "string" && r.session.length <= 100 &&
      typeof r.label === "string" && r.label.length <= 250 &&
      VALID_TYPES.has(r.type) && VALID_STATES.has(r.state) &&
      Number.isFinite(r.createdAt) &&
      (r.endedAt === null || Number.isFinite(r.endedAt))
    ).slice(-60);
  } catch {
    return [];
  }
}

export function recordJobReceipt(job: Job, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const receipt: JobReceipt = {
      id: job.id,
      session: CURRENT_SESSION,
      label: job.label.slice(0, 250),
      type: job.type,
      state: job.state,
      createdAt: job.createdAt,
      endedAt: job.endedAt,
    };
    const records = readJobReceipts(storage).filter((r) => r.id !== receipt.id);
    storage.setItem(KEY, JSON.stringify([...records, receipt].slice(-60)));
  } catch {
    // Storage can be disabled or full; never break a real processing job.
  }
}

export function previousJobReceipts(storage: Storage | null = defaultStorage()): JobReceipt[] {
  return readJobReceipts(storage)
    .filter((job) => job.session !== CURRENT_SESSION)
    .map((job) => ({
      ...job,
      state: FINAL.has(job.state as JobState) ? job.state : "interrupted" as const,
    }))
    .reverse();
}

export function clearJobReceipts(storage: Storage | null = defaultStorage()): void {
  try { storage?.removeItem(KEY); } catch { /* disabled storage */ }
}
