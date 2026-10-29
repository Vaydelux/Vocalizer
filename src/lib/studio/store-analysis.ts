"use client";

/**
 * Analysis results store — real measured values keyed by track, plus manual
 * corrections. Analysis never invents numbers; manual overrides are labeled.
 */

import { create } from "zustand";
import type { BpmResult, KeyResult } from "./types";

export interface StoredBpm extends BpmResult {
  analyzedAt: number;
  manualBpm: number | null;
}

export interface StoredKey extends KeyResult {
  analyzedAt: number;
}

interface AnalysisStore {
  bpmByTrack: Record<string, StoredBpm>;
  keyByTrack: Record<string, StoredKey>;
  manualKeyByTrack: Record<string, string | null>;
  storeBpm: (trackId: string, result: BpmResult) => void;
  storeKey: (trackId: string, result: KeyResult) => void;
  setManualBpm: (trackId: string, bpm: number | null) => void;
  setManualKey: (trackId: string, key: string | null) => void;
  clear: (trackId: string) => void;
}

export const useAnalysis = create<AnalysisStore>((set) => ({
  bpmByTrack: {},
  keyByTrack: {},
  manualKeyByTrack: {},
  storeBpm: (trackId, result) =>
    set((s) => ({ bpmByTrack: { ...s.bpmByTrack, [trackId]: { ...result, analyzedAt: Date.now(), manualBpm: s.bpmByTrack[trackId]?.manualBpm ?? null } } })),
  storeKey: (trackId, result) =>
    set((s) => ({ keyByTrack: { ...s.keyByTrack, [trackId]: { ...result, analyzedAt: Date.now() } } })),
  setManualBpm: (trackId, bpm) =>
    set((s) => {
      const existing = s.bpmByTrack[trackId];
      if (!existing) return s;
      return { bpmByTrack: { ...s.bpmByTrack, [trackId]: { ...existing, manualBpm: bpm } } };
    }),
  setManualKey: (trackId, key) =>
    set((s) => ({ manualKeyByTrack: { ...s.manualKeyByTrack, [trackId]: key } })),
  clear: (trackId) =>
    set((s) => {
      const bpm = { ...s.bpmByTrack };
      const key = { ...s.keyByTrack };
      const mk = { ...s.manualKeyByTrack };
      delete bpm[trackId];
      delete key[trackId];
      delete mk[trackId];
      return { bpmByTrack: bpm, keyByTrack: key, manualKeyByTrack: mk };
    }),
}));
