import { describe, expect, it, afterEach } from "bun:test";
import { audioMetaFromNativeProbe, hasUsableTrackAudio, stemFilenameFromPublishedPath } from "../../src/lib/studio/native-stem-track";
import { useTracks } from "../../src/lib/studio/store-tracks";
import type { StudioNativeApi, NativeAudioMeta } from "../../src/lib/studio/ipc-contracts";

const baseMeta: NativeAudioMeta = {
  duration: 20.5,
  sampleRate: 44100,
  channels: 2,
  codec: "pcm_s24le",
  format: "wav",
  bitrateKbps: 2116,
  sizeBytes: 200_000_000,
};

describe("native disk-backed stem tracks", () => {
  afterEach(() => {
    useTracks.getState().clearAll();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("uses the published file basename so project relinking finds the original stem", () => {
    expect(stemFilenameFromPublishedPath("C:\\\\Users\\\\Music\\\\Vocalizer-job-12-drums.wav"))
      .toBe("Vocalizer-job-12-drums.wav");
    expect(stemFilenameFromPublishedPath("/tmp/output/Vocalizer-job-12-vocals.flac"))
      .toBe("Vocalizer-job-12-vocals.flac");
    expect(() => stemFilenameFromPublishedPath("C:\\\\Music\\\\not-audio.exe")).toThrow();
    expect(() => stemFilenameFromPublishedPath("/tmp/output/")).toThrow();
  });

  it("uses measured duration, rate and channel count without fabricating decoded samples", () => {
    const meta = audioMetaFromNativeProbe(baseMeta);
    expect(meta.duration).toBe(20.5);
    expect(meta.sampleRate).toBe(44100);
    expect(meta.channels).toBe(2);
    expect(meta.lengthSamples).toBeNull();
    expect(meta.metaSource).toBe("native-probe");
  });

  it("rejects malformed duration and empty files before adding a track", () => {
    expect(() => audioMetaFromNativeProbe({...baseMeta, duration: 0})).toThrow();
    expect(() => audioMetaFromNativeProbe({...baseMeta, duration: Number.NaN})).toThrow();
    expect(() => audioMetaFromNativeProbe({...baseMeta, sizeBytes: 0})).toThrow();
    expect(() => audioMetaFromNativeProbe({...baseMeta, channels: null})).toThrow();
  });

  it("registers by verified job+stem reference without transferring the WAV blob", async () => {
    const calls: unknown[] = [];
    const studio = {
      isNative: true,
      probeInferenceStem: async (request: unknown) => {
        calls.push(request);
        return baseMeta;
      },
    } as unknown as StudioNativeApi;
    Object.defineProperty(globalThis, "window", {
      configurable: true, value: { studio },
    });
    const id = await useTracks.getState().addNativeStem(
      "source-job-1", "Drums", "song_Drums.wav",
    );
    const duplicate = await useTracks.getState().addNativeStem(
      "source-job-1", "Drums", "song_Drums.wav",
    );
    const imported = useTracks.getState().tracks.find((track) => track.id === id);
    expect(id).toBe(duplicate);
    expect(calls).toEqual([{jobId:"source-job-1", stem:"Drums"}]);
    expect(imported?.file.size).toBe(0);
    expect(imported?.size).toBe(baseMeta.sizeBytes);
    expect(imported?.nativeStem).toEqual({jobId:"source-job-1", stem:"Drums"});
    expect(imported?.url).toBe("las://renderer/__stem-audio/source-job-1/Drums");
    expect(imported && hasUsableTrackAudio(imported)).toBe(true);
  });

  it("rejects unverifiable stems instead of claiming readiness", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        studio: {
          isNative: true,
          probeInferenceStem: async () => { throw new Error("No completed verified output."); },
        },
      },
    });
    await expect(useTracks.getState().addNativeStem(
      "missing-job", "Vocals", "song_Vocals.wav",
    )).rejects.toThrow();
    expect(useTracks.getState().tracks.length).toBe(0);
  });
});
