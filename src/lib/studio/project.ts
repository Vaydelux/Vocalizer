"use client";

/**
 * Enterprise Project & Session Persistence (.vocalizer)
 *
 * Provides typed serialization, schema validation, session auto-recovery,
 * and project export/import for Local Audio Studio.
 */

import { z } from "zod";
import { create } from "zustand";
import { toast } from "sonner";
import { useTracks, MAX_IMPORT_BYTES } from "./store-tracks";
import { useMixer, type TrackLane } from "./store-mixer";
import { dspEffectChainSchema, DEFAULT_EFFECT_CHAIN } from "./dsp-effects";
import { spatialPositionSchema } from "./spatial-audio";
import { automationLaneSchema, automationPointSchema } from "./automation";
import { probeMetadata } from "./decode";
import { useAnalysis, type StoredBpm, type StoredKey } from "./store-analysis";
import { useUi, type ViewId } from "./store-ui";
import { isNative, native } from "./native";
import { studioError } from "./errors";
import { sanitizeFileName } from "./format";
import type { AudioTrack } from "./types";

export const PROJECT_SCHEMA_VERSION = 2;
// Stable file family signature. A numeric version distinguishes v1 from v2.
export const PROJECT_MAGIC_SCHEMA = "vocalizer-project-v1";
export const AUTOSAVE_LOCAL_STORAGE_KEY = "vocalizer_session_autosave_v1";

export const projectTrackMetaSchema = z.object({
  duration: z.number(),
  sampleRate: z.number().nullable(),
  channels: z.number().nullable(),
  lengthSamples: z.number().nullable(),
  effectiveBitrateKbps: z.number().nullable(),
  probeNote: z.string(),
  metaSource: z.enum(["decoded", "element", "native-probe", "none"]),
});

export const projectTrackSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(100 * 1024 * 1024 * 1024),
  mime: z.string().max(128),
  addedAt: z.number().finite().nonnegative(),
  nativePath: z.string().optional(),
  meta: projectTrackMetaSchema.nullable(),
});

export const projectAnalysisSchema = z.object({
  bpmByTrack: z.record(z.string(), z.any()),
  keyByTrack: z.record(z.string(), z.any()),
  manualKeyByTrack: z.record(z.string(), z.string().nullable()),
});

export const projectMixerLaneSchema = z.object({
  id: z.string().min(1).max(128),
  trackId: z.string().min(1).max(128),
  name: z.string().max(255),
  color: z.string().max(180),
  offsetSec: z.number().finite().min(0).max(86400),
  gainDb: z.number().finite().min(-96).max(24),
  pan: z.number().finite().min(-1).max(1),
  muted: z.boolean(),
  solo: z.boolean(),
  effects: dspEffectChainSchema,
  spatialEnabled: z.boolean().optional(),
  spatialPosition: spatialPositionSchema.optional(),
  automationOpen: z.boolean().optional(),
  automationLanes: z.array(
    automationLaneSchema.extend({
      points: z.array(automationPointSchema).max(10000),
    }),
  ).max(64).optional(),
}).strict();

export const projectMixerSchema = z.object({
  lanes: z.array(projectMixerLaneSchema).max(64),
  masterGainDb: z.number().finite().min(-96).max(24),
  masterEffects: dspEffectChainSchema,
  masterMode: z.enum(["stereo", "binaural", "surround51"]),
  selectedLaneId: z.string().nullable(),
});

function emptyProjectMixer(): z.infer<typeof projectMixerSchema> {
  return {
    lanes: [],
    masterGainDb: 0,
    masterEffects: structuredClone(DEFAULT_EFFECT_CHAIN),
    masterMode: "stereo",
    selectedLaneId: null,
  };
}

export const projectSchema = z.object({
  schema: z.literal(PROJECT_MAGIC_SCHEMA),
  version: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  appVersion: z.string().default("0.3.0"),
  tracks: z.array(projectTrackSchema).max(128),
  analysis: projectAnalysisSchema,
  mixer: projectMixerSchema,
  ui: z.object({
    activeView: z.string(),
    preselectedTrackId: z.string().nullable().optional(),
  }),
});

// Version 1 projects had no mixer snapshot. Validate them explicitly before
// supplying a safe empty mixer, rather than rejecting earlier user files.
const legacyProjectSchema = projectSchema.omit({ mixer: true }).extend({ version: z.literal(1) });

export type VocalizerProject = z.infer<typeof projectSchema>;
export type ProjectTrack = z.infer<typeof projectTrackSchema>;

/* ----------------------------- Project State Store ---------------------------- */

interface ProjectStore {
  projectId: string;
  projectTitle: string;
  isDirty: boolean;
  lastSavedAt: number | null;
  setProjectTitle: (title: string) => void;
  markDirty: () => void;
  markSaved: () => void;
  resetProject: () => void;
}

function generateProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useProject = create<ProjectStore>((set) => ({
  projectId: generateProjectId(),
  projectTitle: "Untitled Project",
  isDirty: false,
  lastSavedAt: null,
  setProjectTitle: (title: string) => set({ projectTitle: title || "Untitled Project", isDirty: true }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
  resetProject: () =>
    set({
      projectId: generateProjectId(),
      projectTitle: "Untitled Project",
      isDirty: false,
      lastSavedAt: null,
    }),
}));

/* --------------------------- Serializer / Deserializer ------------------------- */

export function serializeProject(): VocalizerProject {
  const p = useProject.getState();
  const t = useTracks.getState();
  const a = useAnalysis.getState();
  const u = useUi.getState();
  const mixer = useMixer.getState();

  const tracks: ProjectTrack[] = t.tracks.map((track) => {
    let nativePath: string | undefined = undefined;
    if (isNative()) {
      try {
        nativePath = native()?.getPathForFile(track.file) || undefined;
      } catch {
        // Ignored
      }
    }
    return {
      id: track.id,
      name: track.name,
      size: track.size,
      mime: track.mime,
      addedAt: track.addedAt,
      nativePath,
      meta: track.meta,
    };
  });

  return {
    schema: PROJECT_MAGIC_SCHEMA,
    version: PROJECT_SCHEMA_VERSION,
    id: p.projectId,
    title: p.projectTitle,
    createdAt: new Date(p.lastSavedAt ?? Date.now()).toISOString(),
    updatedAt: new Date().toISOString(),
    appVersion: "0.3.0",
    tracks,
    mixer: {
      lanes: mixer.lanes,
      masterGainDb: mixer.masterGainDb,
      masterEffects: mixer.masterEffects,
      masterMode: mixer.masterMode,
      selectedLaneId: mixer.selectedLaneId,
    },
    analysis: {
      bpmByTrack: a.bpmByTrack,
      keyByTrack: a.keyByTrack,
      manualKeyByTrack: a.manualKeyByTrack,
    },
    ui: {
      activeView: u.activeView,
      preselectedTrackId: u.preselectedTrackId,
    },
  };
}

export function exportProjectJson(): string {
  return JSON.stringify(serializeProject(), null, 2);
}

export function parseProjectJson(raw: string): VocalizerProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw studioError("CORRUPT_FILE", `Invalid JSON project file: ${(err as Error).message}`);
  }

  if (parsed && typeof parsed === "object" && "version" in parsed &&
      (parsed as { version?: unknown }).version === 1) {
    const legacy = legacyProjectSchema.safeParse(parsed);
    if (!legacy.success) {
      throw studioError("CORRUPT_FILE", "Invalid legacy .vocalizer project metadata.");
    }
    return { ...legacy.data, version: PROJECT_SCHEMA_VERSION, mixer: emptyProjectMixer() };
  }

  const result = projectSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0]?.message || "Schema mismatch";
    throw studioError("CORRUPT_FILE", `Unsupported or invalid .vocalizer project format: ${issue}`);
  }
  return result.data;
}

export async function hydrateProject(project: VocalizerProject): Promise<void> {
  // 1. Restore Project identity
  useProject.setState({
    projectId: project.id,
    projectTitle: project.title,
    isDirty: false,
    lastSavedAt: Date.now(),
  });

  // 2. Restore Analysis
  useAnalysis.setState({
    bpmByTrack: (project.analysis.bpmByTrack as Record<string, StoredBpm>) || {},
    keyByTrack: (project.analysis.keyByTrack as Record<string, StoredKey>) || {},
    manualKeyByTrack: project.analysis.manualKeyByTrack || {},
  });

  // 3. Restore metadata only. Audio must be re-imported before processing.
  useTracks.getState().clearAll();
  const restoredTracks: AudioTrack[] = project.tracks.map((pt) => {
    // Create an empty dummy file representation
    const file = new File([], pt.name, { type: pt.mime || "audio/wav", lastModified: pt.addedAt });
    return {
      id: pt.id,
      name: pt.name,
      size: pt.size,
      mime: pt.mime,
      addedAt: pt.addedAt,
      status: "error",
      error: { code: "MISSING_FILE", message: "Re-import the original audio file before processing this restored track." },
      file,
      url: "",
      meta: pt.meta,
    };
  });

  useTracks.setState({ tracks: restoredTracks });

  // 4. Restore mixer controls, including DSP and automation, but never claim
  // missing source files are playable. The mixer can only process tracks after
  // users relink and validate their original media.
  const trackIds = new Set(restoredTracks.map((track) => track.id));
  const lanes = project.mixer.lanes.filter((lane) => trackIds.has(lane.trackId)) as TrackLane[];
  useMixer.setState({
    lanes,
    masterGainDb: project.mixer.masterGainDb,
    masterEffects: structuredClone(project.mixer.masterEffects),
    masterMode: project.mixer.masterMode,
    selectedLaneId: lanes.some((lane) => lane.id === project.mixer.selectedLaneId)
      ? project.mixer.selectedLaneId : null,
  });

  // 5. Restore UI
  const validViews: ViewId[] = [
    "home",
    "remover",
    "splitter",
    "pitcher",
    "key-bpm",
    "cutter",
    "joiner",
    "mixer",
    "batch",
    "recorder",
    "karaoke",
    "models",
    "queue",
    "settings",
    "system",
    "help",
  ];
  const targetView = validViews.includes(project.ui.activeView as ViewId)
    ? (project.ui.activeView as ViewId)
    : "home";

  useUi.setState({
    activeView: targetView,
    preselectedTrackId: project.ui.preselectedTrackId || null,
  });
  // Restoring saved state is not a user modification, even when UI autosave
  // subscribers observe individual store updates during hydration.
  useProject.setState({ isDirty: false, lastSavedAt: Date.now() });
}

/**
 * Reconnect original media after restoring a metadata-only project.
 *
 * Browser/Electron sandbox cannot trust stored native paths as File objects.
 * The user explicitly selects the source files again; each is verified by
 * filename, exact byte size, decoded metadata and unambiguous matching.
 */
export async function relinkProjectTracks(files: readonly File[]): Promise<{
  linked: number; unresolved: number; rejected: number;
}> {
  const projectId = useProject.getState().projectId;
  const previouslyMissing = useTracks.getState().tracks.filter(
    (track) => track.status === "error" && track.file.size === 0 && track.size > 0
  );
  const available = new Set(files);
  let linked = 0;
  let rejected = 0;

  for (const track of previouslyMissing) {
    if (useProject.getState().projectId !== projectId) break;
    const candidates = [...available].filter(
      (file) => file.name === track.name && file.size === track.size &&
        file.size > 0 && file.size <= MAX_IMPORT_BYTES
    );
    if (candidates.length !== 1) {
      if (candidates.length > 1) rejected++;
      continue;
    }
    const file = candidates[0];
    available.delete(file);
    try {
      const measured = await probeMetadata(file);
      const previousDuration = track.meta?.duration;
      if (previousDuration && Number.isFinite(previousDuration) &&
          Math.abs(measured.duration - previousDuration) > Math.max(0.25, previousDuration * 0.01)) {
        rejected++;
        continue;
      }
      // Never apply a stale async probe after another project was loaded.
      if (useProject.getState().projectId !== projectId) break;
      const live = useTracks.getState().tracks.find((item) => item.id === track.id);
      if (!live || live.file.size !== 0 || live.status !== "error") continue;
      const url = URL.createObjectURL(file);
      useTracks.setState((state) => ({
        tracks: state.tracks.map((item) => item.id === track.id
          ? { ...item, file, url, status: "ready", meta: measured,
              size: file.size, mime: file.type || item.mime, error: undefined }
          : item),
      }));
      linked++;
    } catch {
      rejected++;
    }
  }
  if (linked) useProject.getState().markDirty();
  const unresolved = useTracks.getState().tracks.filter(
    (track) => track.status === "error" && track.file.size === 0
  ).length;
  return { linked, unresolved, rejected };
}

/* ----------------------------- Export & Import --------------------------------- */

function triggerBrowserDownload(content: string, filename: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveProjectFile(): Promise<void> {
  const json = exportProjectJson();
  const title = useProject.getState().projectTitle;
  const fileName = `${sanitizeFileName(title)}.vocalizer`;

  triggerBrowserDownload(json, fileName, "application/json");
  useProject.getState().markSaved();
  toast.success("Project saved successfully", { description: fileName });
}

export async function loadProjectFromFile(file: File): Promise<void> {
  try {
    if (file.size > 5 * 1024 * 1024) {
      throw studioError("CORRUPT_FILE", "Project metadata exceeds the 5 MiB safety limit.");
    }
    const raw = await file.text();
    const project = parseProjectJson(raw);
    await hydrateProject(project);
    toast.info("Project restored", { description: `${project.tracks.length} track(s) restored as metadata; use Relink Audio to enable playback and processing.` });
  } catch (err) {
    const msg = (err as Error).message || "Failed to parse project file";
    toast.error("Failed to load project", { description: msg });
    throw err;
  }
}

export function newProject(): void {
  useTracks.getState().clearAll();
  useMixer.setState(emptyProjectMixer());
  useAnalysis.setState({ bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} });
  useUi.setState({ preselectedTrackId: null });
  useProject.getState().resetProject();
  useUi.getState().setView("home");
  toast.info("Created new project");
}

/* ----------------------------- Autosave Session -------------------------------- */

export function saveAutosaveSession(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const json = exportProjectJson();
    window.localStorage.setItem(AUTOSAVE_LOCAL_STORAGE_KEY, json);
  } catch {
    // Session storage full or unavailable
  }
}

export function restoreAutosaveSession(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_LOCAL_STORAGE_KEY);
    if (!raw) return false;
    const project = parseProjectJson(raw);
    if (project.tracks.length > 0 || project.title !== "Untitled Project") {
      void hydrateProject(project);
      return true;
    }
  } catch {
    // Ignore invalid autosave
  }
  return false;
}

export function clearAutosaveSession(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(AUTOSAVE_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
