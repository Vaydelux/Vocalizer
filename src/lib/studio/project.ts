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
import { useTracks } from "./store-tracks";
import { useAnalysis, type StoredBpm, type StoredKey } from "./store-analysis";
import { useUi, type ViewId } from "./store-ui";
import { isNative, native } from "./native";
import { studioError } from "./errors";
import { sanitizeFileName } from "./format";
import type { AudioTrack } from "./types";

export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_MAGIC_SCHEMA = "vocalizer-project-v1";
export const AUTOSAVE_LOCAL_STORAGE_KEY = "vocalizer_session_autosave_v1";

export const projectTrackMetaSchema = z.object({
  duration: z.number(),
  sampleRate: z.number().nullable(),
  channels: z.number().nullable(),
  lengthSamples: z.number().nullable(),
  effectiveBitrateKbps: z.number().nullable(),
  probeNote: z.string(),
  metaSource: z.enum(["decoded", "element", "none"]),
});

export const projectTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mime: z.string(),
  addedAt: z.number(),
  nativePath: z.string().optional(),
  meta: projectTrackMetaSchema.nullable(),
});

export const projectAnalysisSchema = z.object({
  bpmByTrack: z.record(z.string(), z.any()),
  keyByTrack: z.record(z.string(), z.any()),
  manualKeyByTrack: z.record(z.string(), z.string().nullable()),
});

export const projectSchema = z.object({
  schema: z.literal(PROJECT_MAGIC_SCHEMA),
  version: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  appVersion: z.string().default("0.3.0"),
  tracks: z.array(projectTrackSchema),
  analysis: projectAnalysisSchema,
  ui: z.object({
    activeView: z.string(),
    preselectedTrackId: z.string().nullable().optional(),
  }),
});

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

  // 3. Restore Tracks placeholder (restores metadata so library and tools work immediately)
  const restoredTracks: AudioTrack[] = project.tracks.map((pt) => {
    // Create an empty dummy file representation
    const file = new File([], pt.name, { type: pt.mime || "audio/wav", lastModified: pt.addedAt });
    return {
      id: pt.id,
      name: pt.name,
      size: pt.size,
      mime: pt.mime,
      addedAt: pt.addedAt,
      status: "ready",
      file,
      url: "",
      meta: pt.meta,
    };
  });

  useTracks.setState({ tracks: restoredTracks });

  // 4. Restore UI
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
    const raw = await file.text();
    const project = parseProjectJson(raw);
    await hydrateProject(project);
    toast.success("Project loaded", { description: `${project.title} (${project.tracks.length} tracks)` });
  } catch (err) {
    const msg = (err as Error).message || "Failed to parse project file";
    toast.error("Failed to load project", { description: msg });
    throw err;
  }
}

export function newProject(): void {
  useTracks.getState().clearAll();
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
