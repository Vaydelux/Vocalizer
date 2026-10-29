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
  | "system";

interface UiStore {
  activeView: ViewId;
  sidebarCollapsed: boolean;
  /** Track preselected by another page via "open with" actions. */
  preselectedTrackId: string | null;
  setView: (view: ViewId) => void;
  openTrackWith: (trackId: string, view: ViewId) => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiStore>((set) => ({
  activeView: "home",
  sidebarCollapsed: false,
  preselectedTrackId: null,
  setView: (view) => set({ activeView: view }),
  openTrackWith: (trackId, view) => set({ preselectedTrackId: trackId, activeView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
