import { describe, it, expect } from "bun:test";
import { parseProjectJson, PROJECT_MAGIC_SCHEMA, PROJECT_SCHEMA_VERSION, type VocalizerProject } from "../../src/lib/studio/project";

describe("enterprise project persistence (.vocalizer)", () => {
  it("parses valid .vocalizer project JSON", () => {
    const validProject: VocalizerProject = {
      schema: PROJECT_MAGIC_SCHEMA,
      version: PROJECT_SCHEMA_VERSION,
      id: "test-proj-123",
      title: "Vocal Master 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: "0.3.0",
      tracks: [
        {
          id: "trk-1",
          name: "vocal_lead.wav",
          size: 1048576,
          mime: "audio/wav",
          addedAt: 1730000000000,
          nativePath: "/home/user/Music/vocal_lead.wav",
          meta: {
            duration: 120.5,
            sampleRate: 48000,
            channels: 2,
            lengthSamples: 5784000,
            effectiveBitrateKbps: 1536,
            probeNote: "Decoded via FFmpeg / WebAudio",
            metaSource: "decoded",
          },
        },
      ],
      analysis: {
        bpmByTrack: {
          "trk-1": { bpm: 128, confidence: 0.95, analyzedAt: 1730000000000, manualBpm: null },
        },
        keyByTrack: {
          "trk-1": { key: "C major", confidence: 0.88, analyzedAt: 1730000000000 },
        },
        manualKeyByTrack: {},
      },
      ui: {
        activeView: "cutter",
        preselectedTrackId: "trk-1",
      },
    };

    const parsed = parseProjectJson(JSON.stringify(validProject));
    expect(parsed.id).toBe("test-proj-123");
    expect(parsed.title).toBe("Vocal Master 2026");
    expect(parsed.tracks.length).toBe(1);
    expect(parsed.tracks[0].meta?.duration).toBe(120.5);
    expect(parsed.analysis.bpmByTrack["trk-1"].bpm).toBe(128);
  });

  it("throws on corrupt JSON or missing schema signature", () => {
    expect(() => parseProjectJson("{ not valid json")).toThrow();

    const missingSchema = {
      version: 1,
      id: "abc",
      title: "test",
      tracks: [],
    };
    expect(() => parseProjectJson(JSON.stringify(missingSchema))).toThrow();
  });

  it("rejects unsupported schema versions", () => {
    const wrongVersion = {
      schema: PROJECT_MAGIC_SCHEMA,
      version: 99,
      id: "abc",
      title: "Future Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tracks: [],
      analysis: { bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} },
      ui: { activeView: "home" },
    };
    expect(() => parseProjectJson(JSON.stringify(wrongVersion))).toThrow();
  });
});
