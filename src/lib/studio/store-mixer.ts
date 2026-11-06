"use client";

/**
 * Multi-Track Mixer & Timeline State Store
 *
 * Manages arrangement lanes, volume faders, stereo panning, solo/mute matrices,
 * per-track DSP effect racks, and master bus processing.
 */

import { create } from "zustand";
import { DEFAULT_EFFECT_CHAIN, type DspEffectChain } from "./dsp-effects";
import { DEFAULT_SPATIAL_POSITION, type SpatialPosition } from "./spatial-audio";
import {
  type AutomationLane,
  type AutomationPoint,
  type AutomationTarget,
} from "./automation";
import { getTrackById } from "./store-tracks";

export const LANE_COLORS = [
  "border-violet-500 bg-violet-500/10 text-violet-400",
  "border-sky-500 bg-sky-500/10 text-sky-400",
  "border-emerald-500 bg-emerald-500/10 text-emerald-400",
  "border-amber-500 bg-amber-500/10 text-amber-400",
  "border-rose-500 bg-rose-500/10 text-rose-400",
  "border-indigo-500 bg-indigo-500/10 text-indigo-400",
] as const;

export interface TrackLane {
  id: string;
  trackId: string;
  name: string;
  color: string;
  offsetSec: number;
  gainDb: number;
  pan: number; // -1 (left) to +1 (right)
  muted: boolean;
  solo: boolean;
  effects: DspEffectChain;
  spatialEnabled?: boolean;
  spatialPosition?: SpatialPosition;
  automationLanes?: AutomationLane[];
  automationOpen?: boolean;
}

interface MixerStore {
  lanes: TrackLane[];
  masterGainDb: number;
  masterEffects: DspEffectChain;
  masterMode: "stereo" | "binaural" | "surround51";
  selectedLaneId: string | null;

  addLane: (trackId: string) => void;
  removeLane: (laneId: string) => void;
  updateLane: (laneId: string, patch: Partial<TrackLane>) => void;
  updateLaneEffects: (laneId: string, patch: Partial<DspEffectChain>) => void;
  updateLaneSpatial: (laneId: string, patch: Partial<SpatialPosition>) => void;
  toggleLaneSpatial: (laneId: string) => void;
  toggleLaneAutomation: (laneId: string) => void;
  setLaneAutomationPoint: (laneId: string, target: AutomationTarget, point: Omit<AutomationPoint, "id">) => void;
  updateLaneAutomationPoint: (laneId: string, target: AutomationTarget, pointId: string, patch: Partial<AutomationPoint>) => void;
  removeLaneAutomationPoint: (laneId: string, target: AutomationTarget, pointId: string) => void;
  clearLaneAutomation: (laneId: string, target: AutomationTarget) => void;
  toggleMute: (laneId: string) => void;
  toggleSolo: (laneId: string) => void;
  setSelectedLane: (laneId: string | null) => void;
  setMasterMode: (mode: "stereo" | "binaural" | "surround51") => void;
  updateMasterGain: (gainDb: number) => void;
  updateMasterEffects: (patch: Partial<DspEffectChain>) => void;
  clearAllLanes: () => void;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `lane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useMixer = create<MixerStore>((set) => ({
  lanes: [],
  masterGainDb: 0,
  masterEffects: { ...DEFAULT_EFFECT_CHAIN },
  masterMode: "stereo",
  selectedLaneId: null,

  addLane: (trackId) => {
    const track = getTrackById(trackId);
    if (!track) return;
    set((s) => {
      const color = LANE_COLORS[s.lanes.length % LANE_COLORS.length];
      const newLane: TrackLane = {
        id: uuid(),
        trackId: track.id,
        name: track.name,
        color,
        offsetSec: 0,
        gainDb: 0,
        pan: 0,
        muted: false,
        solo: false,
        effects: JSON.parse(JSON.stringify(DEFAULT_EFFECT_CHAIN)),
        spatialEnabled: false,
        spatialPosition: { ...DEFAULT_SPATIAL_POSITION },
      };
      return {
        lanes: [...s.lanes, newLane],
        selectedLaneId: s.selectedLaneId ?? newLane.id,
      };
    });
  },

  removeLane: (laneId) =>
    set((s) => ({
      lanes: s.lanes.filter((l) => l.id !== laneId),
      selectedLaneId: s.selectedLaneId === laneId ? (s.lanes.find((l) => l.id !== laneId)?.id ?? null) : s.selectedLaneId,
    })),

  updateLane: (laneId, patch) =>
    set((s) => ({
      lanes: s.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)),
    })),

  updateLaneEffects: (laneId, patch) =>
    set((s) => ({
      lanes: s.lanes.map((l) =>
        l.id === laneId ? { ...l, effects: { ...l.effects, ...patch } } : l
      ),
    })),

  updateLaneSpatial: (laneId, patch) =>
    set((s) => ({
      lanes: s.lanes.map((l) =>
        l.id === laneId
          ? {
              ...l,
              spatialPosition: {
                ...(l.spatialPosition ?? DEFAULT_SPATIAL_POSITION),
                ...patch,
              },
            }
          : l
      ),
    })),

  toggleLaneSpatial: (laneId) =>
    set((s) => ({
      lanes: s.lanes.map((l) =>
        l.id === laneId ? { ...l, spatialEnabled: !l.spatialEnabled } : l
      ),
    })),

  toggleLaneAutomation: (laneId) =>
    set((s) => ({
      lanes: s.lanes.map((l) =>
        l.id === laneId ? { ...l, automationOpen: !l.automationOpen } : l
      ),
    })),

  setLaneAutomationPoint: (laneId, target, point) =>
    set((s) => ({
      lanes: s.lanes.map((l) => {
        if (l.id !== laneId) return l;
        const currentLanes = l.automationLanes ?? [];
        const existingLane = currentLanes.find((al) => al.target === target);
        const newPoint: AutomationPoint = {
          ...point,
          id: uuid(),
        };

        let updatedLanes: AutomationLane[];
        if (existingLane) {
          updatedLanes = currentLanes.map((al) =>
            al.target === target
              ? {
                  ...al,
                  points: [...al.points, newPoint].sort((a, b) => a.timeSec - b.timeSec),
                }
              : al
          );
        } else {
          updatedLanes = [
            ...currentLanes,
            {
              id: uuid(),
              target,
              enabled: true,
              points: [newPoint],
            },
          ];
        }

        return { ...l, automationLanes: updatedLanes };
      }),
    })),

  updateLaneAutomationPoint: (laneId, target, pointId, patch) =>
    set((s) => ({
      lanes: s.lanes.map((l) => {
        if (l.id !== laneId) return l;
        const updatedLanes = (l.automationLanes ?? []).map((al) => {
          if (al.target !== target) return al;
          return {
            ...al,
            points: al.points
              .map((p) => (p.id === pointId ? { ...p, ...patch } : p))
              .sort((a, b) => a.timeSec - b.timeSec),
          };
        });
        return { ...l, automationLanes: updatedLanes };
      }),
    })),

  removeLaneAutomationPoint: (laneId, target, pointId) =>
    set((s) => ({
      lanes: s.lanes.map((l) => {
        if (l.id !== laneId) return l;
        const updatedLanes = (l.automationLanes ?? []).map((al) => {
          if (al.target !== target) return al;
          return {
            ...al,
            points: al.points.filter((p) => p.id !== pointId),
          };
        });
        return { ...l, automationLanes: updatedLanes };
      }),
    })),

  clearLaneAutomation: (laneId, target) =>
    set((s) => ({
      lanes: s.lanes.map((l) => {
        if (l.id !== laneId) return l;
        return {
          ...l,
          automationLanes: (l.automationLanes ?? []).filter((al) => al.target !== target),
        };
      }),
    })),

  toggleMute: (laneId) =>
    set((s) => ({
      lanes: s.lanes.map((l) => (l.id === laneId ? { ...l, muted: !l.muted } : l)),
    })),

  toggleSolo: (laneId) =>
    set((s) => ({
      lanes: s.lanes.map((l) => (l.id === laneId ? { ...l, solo: !l.solo } : l)),
    })),

  setSelectedLane: (laneId) => set({ selectedLaneId: laneId }),

  setMasterMode: (mode) => set({ masterMode: mode }),

  updateMasterGain: (gainDb) => set({ masterGainDb: gainDb }),

  updateMasterEffects: (patch) =>
    set((s) => ({ masterEffects: { ...s.masterEffects, ...patch } })),

  clearAllLanes: () => set({ lanes: [], selectedLaneId: null }),
}));

/**
 * Determines whether a given lane should actually produce audible output
 * based on the global solo/mute matrix.
 */
export function isLaneAudible(lane: TrackLane, allLanes: TrackLane[]): boolean {
  if (lane.muted) return false;
  const anySoloActive = allLanes.some((l) => l.solo);
  if (anySoloActive) {
    return lane.solo;
  }
  return true;
}
