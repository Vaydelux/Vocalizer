import { afterEach, describe, expect, it } from "bun:test";
import { hydrateProject, parseProjectJson, relinkProjectNativeStems, serializeProject, useProject } from "../../src/lib/studio/project";
import { useTracks } from "../../src/lib/studio/store-tracks";
import { useMixer } from "../../src/lib/studio/store-mixer";
import { DEFAULT_EFFECT_CHAIN } from "../../src/lib/studio/dsp-effects";
import type { StudioNativeApi, NativeAudioMeta } from "../../src/lib/studio/ipc-contracts";

const filename = "Vocalizer-recover_7-vocals.wav";
const hugeSize = 1_073_741_824; // 1 GiB: exceeds the 500 MiB browser import cap
const nativeMeta: NativeAudioMeta = {
  sizeBytes: hugeSize, duration: 1800, channels: 2, sampleRate: 48000,
  codec: "pcm_s24le", format: "wav", bitrateKbps: 2304,
};

async function restoreLargeStem(): Promise<void> {
  await hydrateProject(parseProjectJson(JSON.stringify({
    schema: "vocalizer-project-v1", version: 2, id: "large-relink",
    title: "Large stem recovery", createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tracks: [{
      id: "original-track", name: filename, size: hugeSize, mime: "audio/wav",
      addedAt: 1730000000000,
      meta: {
        duration: 1800, sampleRate: 48000, channels: 2, lengthSamples: null,
        effectiveBitrateKbps: 2304, probeNote: "Saved verified source",
        metaSource: "native-probe",
      },
    }],
    analysis: { bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} },
    ui: { activeView: "mixer", preselectedTrackId: null },
    mixer: {
      lanes: [{
        id: "original-lane", trackId: "original-track", name: "Lead",
        color: "text-violet-400", offsetSec: 0, gainDb: -3, pan: 0,
        muted: false, solo: false, effects: structuredClone(DEFAULT_EFFECT_CHAIN),
      }],
      masterGainDb: -1, masterEffects: structuredClone(DEFAULT_EFFECT_CHAIN),
      masterMode: "stereo", selectedLaneId: "original-lane",
    },
  })));
}

function fakeNative(relink: StudioNativeApi["relinkInferenceStems"]): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { studio: { isNative: true, relinkInferenceStems: relink } },
  });
}

describe("large saved-stem project recovery", () => {
  afterEach(() => {
    useTracks.getState().clearAll();
    useMixer.getState().clearAllLanes();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("restores a 1 GiB track by verified reference while preserving mixer lane identity", async () => {
    await restoreLargeStem();
    let calls = 0;
    fakeNative(async (request) => {
      calls++;
      expect(request.expected).toEqual([{
        name: filename, size: hugeSize, duration: 1800,
      }]);
      return {
        cancelled: false, rejected: 0,
        files: [{
          name: filename, jobId: "recover_7", stem: "Vocals", meta: nativeMeta,
        }],
      };
    });
    const result = await relinkProjectNativeStems();
    const restored = useTracks.getState().tracks[0];
    expect(result).toEqual({ linked: 1, unresolved: 0, rejected: 0, cancelled: false });
    expect(calls).toBe(1);
    expect(restored.id).toBe("original-track");
    expect(restored.status).toBe("ready");
    expect(restored.file.size).toBe(0);
    expect(restored.size).toBe(hugeSize);
    expect(restored.nativeStem).toEqual({ jobId: "recover_7", stem: "Vocals" });
    expect(restored.url).toBe("las://renderer/__stem-audio/recover_7/Vocals");
    expect(useMixer.getState().lanes[0].trackId).toBe("original-track");
    expect(serializeProject().tracks[0].name).toBe(filename);
    expect(serializeProject().tracks[0]).not.toHaveProperty("nativePath");
    expect(useProject.getState().isDirty).toBe(true);
  });

  it("keeps the original unavailable when native metadata mismatches", async () => {
    await restoreLargeStem();
    fakeNative(async () => ({
      cancelled: false, rejected: 0,
      files: [{
        name: filename, jobId: "recover_7", stem: "Vocals",
        meta: { ...nativeMeta, sizeBytes: hugeSize - 1 },
      }],
    }));
    const result = await relinkProjectNativeStems();
    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(useTracks.getState().tracks[0].status).toBe("error");
  });

  it("does not enable audio when the native dialog is cancelled", async () => {
    await restoreLargeStem();
    fakeNative(async () => ({ cancelled: true, rejected: 0, files: [] }));
    const result = await relinkProjectNativeStems();
    expect(result.cancelled).toBe(true);
    expect(result.linked).toBe(0);
    expect(useTracks.getState().tracks[0].file.size).toBe(0);
    expect(useTracks.getState().tracks[0].status).toBe("error");
  });
});
