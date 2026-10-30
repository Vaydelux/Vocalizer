"use client";

import { create } from "zustand";

export type ViewId =
  | "home"
  | "remover"
  | "splitter"
  | "pitcher"
  | "key-bpm"
  | "cutter"
  | "joiner"
  | "recorder"
  | "karaoke"
  | "models"
  | "queue"
  | "settings"
  | "system"
  | "help";

interface UiStore {
  activeView: ViewId;
  sidebarCollapsed: boolean;
  /** Track preselected by another page via "open with" actions. */
  preselectedTrackId: string | null;
  helpTopicId: ViewId | null;
  setView: (view: ViewId) => void;
  openHelp: (source?: ViewId) => void;
  openTrackWith: (trackId: string, view: ViewId) => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiStore>((set) => ({
  activeView: "home",
  sidebarCollapsed: false,
  preselectedTrackId: null,
  helpTopicId: null,
  setView: (view) => set({ activeView: view }),
  openHelp: (source) => set((s) => ({ helpTopicId: source ?? s.activeView, activeView: "help" })),
  openTrackWith: (trackId, view) => set({ preselectedTrackId: trackId, activeView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
