"use client";

/**
 * Enterprise High-Throughput Batch Audio Processing Engine
 *
 * Manages bulk transcode, sample rate resampling, silence stripping,
 * and broadcast loudness normalization across 10 to 100+ audio files.
 */

import { z } from "zod";
import { create } from "zustand";
import { toast } from "sonner";
import type { ExportFormat, Mp3Bitrate, SampleRatePref, JobResultFile } from "./types";
import { getTrackById, useTracks } from "./store-tracks";
import { useJobs } from "./store-jobs";
import { makeConvertTask } from "./tasks";
import { sanitizeFileName } from "./format";

/* ------------------------------- Zod Schemas ------------------------------- */

export const batchRecipeSchema = z.object({
  targetFormat: z.enum(["wav16", "wav24", "mp3"]),
  mp3Bitrate: z.union([z.literal(128), z.literal(192), z.literal(256), z.literal(320)]),
  sampleRatePref: z.union([z.literal("auto"), z.literal(44100), z.literal(48000)]),
  loudnessNormalize: z
    .object({
      targetLufs: z.number().min(-30).max(-10).default(-14),
      truePeak: z.number().min(-6).max(0).default(-1),
    })
    .nullable(),
  stripSilence: z.boolean().default(false),
  namingPattern: z.string().min(1).max(64).default("[name]_mastered"),
  concurrency: z.number().int().min(1).max(4).default(2),
});

export type BatchRecipe = z.infer<typeof batchRecipeSchema>;

export interface BatchItem {
  id: string;
  trackId: string;
  trackName: string;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  progress: number;
  stage?: string;
  outputName?: string;
  outputUrl?: string;
  error?: string;
}

export const DEFAULT_BATCH_RECIPE: BatchRecipe = {
  targetFormat: "wav16",
  mp3Bitrate: 192,
  sampleRatePref: "auto",
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  stripSilence: false,
  namingPattern: "[name]_mastered",
  concurrency: 2,
};

/* -------------------------------- Batch Store ------------------------------- */

interface BatchStore {
  items: BatchItem[];
  recipe: BatchRecipe;
  isRunning: boolean;
  abortController: AbortController | null;

  addTracks: (trackIds: string[]) => void;
  addAllReadyTracks: () => void;
  removeItem: (itemId: string) => void;
  clearItems: () => void;
  updateRecipe: (patch: Partial<BatchRecipe>) => void;
  startBatch: () => Promise<void>;
  cancelBatch: () => void;
}

export function applyNamingPattern(originalName: string, pattern: string): string {
  const base = originalName.replace(/\.[^/.]+$/, "");
  const applied = pattern.replace("[name]", base);
  return sanitizeFileName(applied);
}

export const useBatch = create<BatchStore>((set, get) => ({
  items: [],
  recipe: DEFAULT_BATCH_RECIPE,
  isRunning: false,
  abortController: null,

  addTracks: (trackIds) => {
    const current = get().items;
    const existingTrackIds = new Set(current.map((i) => i.trackId));
    const newItems: BatchItem[] = [];

    for (const trackId of trackIds) {
      if (existingTrackIds.has(trackId)) continue;
      const track = getTrackById(trackId);
      if (!track) continue;

      newItems.push({
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        trackId: track.id,
        trackName: track.name,
        status: "pending",
        progress: 0,
      });
    }

    if (newItems.length > 0) {
      set({ items: [...current, ...newItems] });
      toast.info(`Added ${newItems.length} track(s) to batch queue`);
    }
  },

  addAllReadyTracks: () => {
    const ready = useTracks.getState().tracks.filter((t) => t.status === "ready");
    get().addTracks(ready.map((t) => t.id));
  },

  removeItem: (itemId) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),

  clearItems: () => {
    if (get().isRunning) {
      get().cancelBatch();
    }
    set({ items: [] });
  },

  updateRecipe: (patch) =>
    set((s) => ({ recipe: { ...s.recipe, ...patch } })),

  startBatch: async () => {
    const { items, recipe, isRunning } = get();
    if (isRunning) return;

    const pending = items.filter((i) => i.status === "pending" || i.status === "error");
    if (pending.length === 0) {
      toast.info("No pending tracks to process");
      return;
    }

    const abortController = new AbortController();
    set({ isRunning: true, abortController });

    const jobsEnqueue = useJobs.getState().enqueue;
    let completedCount = 0;
    let errorCount = 0;

    toast.info(`Starting batch of ${pending.length} tracks (concurrency: ${recipe.concurrency})`);

    // Worker pool for concurrency
    const queue = [...pending];
    const runWorker = async () => {
      while (queue.length > 0 && !abortController.signal.aborted) {
        const item = queue.shift();
        if (!item) break;

        const track = getTrackById(item.trackId);
        if (!track) {
          set((s) => ({
            items: s.items.map((i) => (i.id === item.id ? { ...i, status: "error", error: "Track not found" } : i)),
          }));
          errorCount++;
          continue;
        }

        // Mark processing
        set((s) => ({
          items: s.items.map((i) => (i.id === item.id ? { ...i, status: "processing", progress: 0.05 } : i)),
        }));

        try {
          const outputName = applyNamingPattern(track.name, recipe.namingPattern);
          const sampleRate = recipe.sampleRatePref === "auto" ? null : recipe.sampleRatePref;
          const task = makeConvertTask({
            file: track.file,
            friendlyName: outputName,
            sampleRate,
            format: recipe.targetFormat,
            mp3Bitrate: recipe.mp3Bitrate,
            loudnessNormalize: recipe.loudnessNormalize ?? undefined,
          });

          // Enqueue in global processing queue
          const jobId = jobsEnqueue(
            "convert",
            `Batch: ${outputName}`,
            task
          );

          // Track completion via job poll / listener
          await new Promise<void>((resolve, reject) => {
            const unsub = useJobs.subscribe((state) => {
              const job = state.jobs.find((j) => j.id === jobId);
              if (!job) return;

              if (job.state === "running") {
                set((s) => ({
                  items: s.items.map((i) =>
                    i.id === item.id ? { ...i, progress: job.progress ?? 0, stage: job.stage ?? undefined } : i
                  ),
                }));
              } else if (job.state === "completed") {
                unsub();
                set((s) => ({
                  items: s.items.map((i) =>
                    i.id === item.id
                      ? {
                          ...i,
                          status: "done",
                          progress: 1.0,
                          outputName: job.result?.name,
                          outputUrl: job.result?.url,
                        }
                      : i
                  ),
                }));
                completedCount++;
                resolve();
              } else if (job.state === "failed") {
                unsub();
                set((s) => ({
                  items: s.items.map((i) =>
                    i.id === item.id
                      ? { ...i, status: "error", error: job.error?.message ?? "Transcoding failed" }
                      : i
                  ),
                }));
                errorCount++;
                reject(new Error(job.error?.message ?? "Transcoding failed"));
              } else if (job.state === "cancelled") {
                unsub();
                set((s) => ({
                  items: s.items.map((i) => (i.id === item.id ? { ...i, status: "cancelled" } : i)),
                }));
                resolve();
              }
            });
          });
        } catch (err) {
          // Error captured in job subscription
        }
      }
    };

    const workers = Array.from({ length: recipe.concurrency }, () => runWorker());
    await Promise.all(workers);

    set({ isRunning: false, abortController: null });
    toast.success("Batch processing finished", {
      description: `Completed: ${completedCount} | Errors: ${errorCount}`,
    });
  },

  cancelBatch: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({
      isRunning: false,
      abortController: null,
      items: get().items.map((i) => (i.status === "processing" ? { ...i, status: "cancelled" } : i)),
    });
    toast.info("Batch processing cancelled");
  },
}));
