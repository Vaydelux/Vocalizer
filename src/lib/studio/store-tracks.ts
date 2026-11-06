"use client";

/**
 * Track library — files live in renderer memory only (object URLs). Nothing is
 * uploaded anywhere. Import validation is real: metadata is probed by actually
 * decoding (or measuring, for large files) — extensions are never trusted.
 */

import { create } from "zustand";
import { toast } from "sonner";
import type { AudioTrack } from "./types";
import { probeMetadata, MAX_DECODE_BYTES } from "./decode";
import { dropPeaks } from "./peaks";
import { studioError, toStudioError } from "./errors";
import { formatBytes } from "./format";
import { native } from "./native";
import { audioMetaFromNativeProbe } from "./native-stem-track";
import { nativeStemPlaybackUrl } from "../../../electron/shared/stem-input";
import type { ModelStem } from "./types";

export const MAX_IMPORT_BYTES = 500 * 1024 * 1024; // 500 MB hard import cap

interface TracksStore {
  tracks: AudioTrack[];
  addFiles: (files: File[] | FileList) => void;
  /** Register a completed, verified native stem without fetching it into RAM. */
  addNativeStem: (jobId: string, stem: ModelStem, displayName: string) => Promise<string>;
  removeTrack: (id: string) => void;
  retryTrack: (id: string) => void;
  clearAll: () => void;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function probeTrack(track: AudioTrack): Promise<void> {
  const { useTracks } = await import("./store-tracks"); // stable self-reference
  try {
    const meta = await probeMetadata(track.file);
    useTracks.setState((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === track.id ? { ...t, status: "ready", meta, error: undefined } : t
      ),
    }));
  } catch (err) {
    const e = toStudioError(err);
    useTracks.setState((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === track.id ? { ...t, status: "error", error: e } : t
      ),
    }));
    toast.error(`Import failed: ${track.name}`, {
      description: `[${e.code}] ${e.message}`,
    });
  }
}

export const useTracks = create<TracksStore>((set, get) => ({
  tracks: [],
  addNativeStem: async (jobId, stem, displayName) => {
    const existing = get().tracks.find(
      (track) => track.nativeStem?.jobId === jobId && track.nativeStem?.stem === stem
    );
    if (existing) return existing.id;
    const api = native();
    if (!api) throw new Error("Disk-backed tracks require the native Windows app.");
    // The privileged main process only probes completed verified job output.
    const measured = await api.probeInferenceStem({ jobId, stem });
    const meta = audioMetaFromNativeProbe(measured);
    const ref = { jobId, stem };
    const url = nativeStemPlaybackUrl(ref);
    const second = get().tracks.find(
      (track) => track.nativeStem?.jobId === jobId && track.nativeStem?.stem === stem
    );
    if (second) return second.id; // async duplicate registration race
    const name = displayName.replace(/[\\/\\:<>|?*]/g, "_").slice(0, 250);
    const ext = name.toLowerCase().endsWith(".flac") ? "flac"
      : name.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const type = ext === "flac" ? "audio/flac" : ext === "mp3" ? "audio/mpeg" : "audio/wav";
    const track: AudioTrack = {
      id: uuid(),
      name,
      size: measured.sizeBytes,
      mime: type,
      addedAt: Date.now(),
      status: "ready",
      // No audio bytes are loaded into this zero-byte reference. The file
      // is intentionally not used for native processing or browser decoding.
      file: new File([], name, { type }),
      nativeStem: ref,
      url,
      meta,
    };
    set((state) => ({ tracks: [...state.tracks, track] }));
    return track.id;
  },
  addFiles: (files) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const added: AudioTrack[] = [];
    const existing = new Set(get().tracks.map((t) => `${t.name}| ${t.size}|${t.file.lastModified}`));
    let duplicateCount = 0;
    for (const file of incoming) {
      const key = `${file.name}| ${file.size}|${file.lastModified}`;
      if (existing.has(key)) {
        duplicateCount++;
        continue;
      }
      existing.add(key);
      if (file.size === 0) {
        toast.error(`Import failed: ${file.name}`, { description: "The selected file is empty." });
        continue;
      }
      if (file.size > MAX_IMPORT_BYTES) {
        toast.error(`Import failed: ${file.name}`, {
          description: `[FILE_TOO_LARGE] ${formatBytes(file.size)} exceeds the ${formatBytes(
            MAX_IMPORT_BYTES
          )} in-memory limit of this build.`,
        });
        continue;
      }
      const track: AudioTrack = {
        id: uuid(),
        name: file.name,
        size: file.size,
        mime: file.type || "unknown",
        addedAt: Date.now(),
        status: "checking",
        file,
        url: URL.createObjectURL(file),
        meta: null,
      };
      added.push(track);
    }
    if (duplicateCount > 0) {
      toast.info(`Skipped ${duplicateCount} duplicate file${duplicateCount === 1 ? "" : "s"}`);
    }
    if (added.length === 0) return;
    set((s) => ({ tracks: [...s.tracks, ...added] }));
    toast.info(
      `Importing ${added.length} file${added.length > 1 ? "s" : ""}…`,
      { description: "Validating with the audio decoder — not just the file extension." }
    );
    for (const t of added) void probeTrack(t);
  },
  retryTrack: (id) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track || track.status === "checking") return;
    if (track.nativeStem) {
      const ref = track.nativeStem;
      const api = native();
      if (!api) return;
      set((state) => ({
        tracks: state.tracks.map((entry) => entry.id === id
          ? { ...entry, status: "checking" } : entry),
      }));
      void api.probeInferenceStem(ref).then((measured) => {
        const meta = audioMetaFromNativeProbe(measured);
        set((state) => ({
          tracks: state.tracks.map((entry) => entry.id === id && entry.nativeStem === ref
            ? { ...entry, status: "ready", meta, error: undefined } : entry),
        }));
      }).catch(() => {
        set((state) => ({
          tracks: state.tracks.map((entry) => entry.id === id && entry.nativeStem === ref
            ? { ...entry, status: "error",
                error: { code: "MISSING_FILE", message: "Verified stem is no longer available. Rerun separation." } }
            : entry),
        }));
      });
      return;
    }
    if (track.file.size === 0) {
      toast.error("Original media unavailable", { description: "Re-import the original audio file to restore this track." });
      return;
    }
    set((s) => ({
      tracks: s.tracks.map((t) => t.id === id
        ? { ...t, status: "checking", error: undefined, meta: null } : t),
    }));
    void probeTrack(track);
  },
  removeTrack: (id) => {
    const track = get().tracks.find((t) => t.id === id);
    if (track) {
      if (track.url.startsWith("blob:")) URL.revokeObjectURL(track.url);
      dropPeaks(id);
    }
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
  },
  clearAll: () => {
    for (const t of get().tracks) {
      if (t.url.startsWith("blob:")) URL.revokeObjectURL(t.url);
      dropPeaks(t.id);
    }
    set({ tracks: [] });
  },
}));

/** Convenience non-hook getter. */
export function getTrackById(id: string): AudioTrack | undefined {
  return useTracks.getState().tracks.find((t) => t.id === id);
}

export { MAX_DECODE_BYTES };
export function unsupportedDecodeNote(): string {
  return studioError("UNSUPPORTED_MEDIA").message;
}
