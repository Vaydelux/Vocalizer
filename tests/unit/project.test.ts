import { describe, it, expect } from "bun:test";
import {
  parseProjectJson, hydrateProject, serializeProject,
  PROJECT_MAGIC_SCHEMA, PROJECT_SCHEMA_VERSION, type VocalizerProject
} from "../../src/lib/studio/project";
import { useMixer } from "../../src/lib/studio/store-mixer";
import { useTracks } from "../../src/lib/studio/store-tracks";
import { DEFAULT_EFFECT_CHAIN } from "../../src/lib/studio/dsp-effects";

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
      mixer: {
        lanes: [{
          id: "lane-1",
          trackId: "trk-1",
          name: "Lead Vocal",
          color: "border-violet-500 bg-violet-500/10 text-violet-400",
          offsetSec: 0.5,
          gainDb: -2,
          pan: -0.25,
          muted: false,
          solo: false,
          effects: structuredClone(DEFAULT_EFFECT_CHAIN),
          spatialEnabled: false,
          automationLanes: [{ id: "a1", target: "volume", enabled: true,
            points: [{ id: "p1", timeSec: 1, value: -6, curveType: "linear" }] }],
        }],
        masterGainDb: -1,
        masterEffects: structuredClone(DEFAULT_EFFECT_CHAIN),
        masterMode: "stereo",
        selectedLaneId: "lane-1",
      },
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
    expect(parsed.mixer.lanes[0].automationLanes?.[0].points[0].value).toBe(-6);
    expect(parsed.mixer.masterGainDb).toBe(-1);

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
  it("migrates legacy v1 metadata without inventing mixer lanes", () => {
    const legacy = {
      schema: PROJECT_MAGIC_SCHEMA,
      version: 1,
      id: "old-proj",
      title: "Legacy Session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tracks: [],
      analysis: { bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} },
      ui: { activeView: "home", preselectedTrackId: null },
    };
    const migrated = parseProjectJson(JSON.stringify(legacy));
    expect(migrated.version).toBe(2);
    expect(migrated.mixer.lanes).toEqual([]);
    expect(migrated.mixer.masterGainDb).toBe(0);
  });

  it("rejects corrupted mixer data instead of enabling unsafe DSP settings", () => {
    const project = {
      schema: PROJECT_MAGIC_SCHEMA, version: PROJECT_SCHEMA_VERSION,
      id: "corrupt", title: "Unsafe",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      tracks: [], analysis: { bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} },
      ui: { activeView: "home" },
      mixer: { lanes: [], masterGainDb: 200, masterEffects: DEFAULT_EFFECT_CHAIN,
               masterMode: "stereo", selectedLaneId: null },
    };
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow();
  });

  it("restores mixer controls while leaving audio unavailable until relink", async () => {
    const fixture = {
      schema: PROJECT_MAGIC_SCHEMA,
      version: PROJECT_SCHEMA_VERSION,
      id: "recover-123",
      title: "Recovered Session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tracks: [{
        id: "restore-track-1", name: "source.wav", size: 512,
        mime: "audio/wav", addedAt: 1730000000000,
        meta: null,
      }],
      analysis: { bpmByTrack: {}, keyByTrack: {}, manualKeyByTrack: {} },
      ui: { activeView: "mixer", preselectedTrackId: null },
      mixer: {
        lanes: [{
          id: "restore-lane-1", trackId: "restore-track-1", name: "Source",
          color: "border-violet-500 bg-violet-500/10 text-violet-400",
          offsetSec: 1, gainDb: -4, pan: 0.2, muted: false, solo: false,
          effects: structuredClone(DEFAULT_EFFECT_CHAIN),
        }],
        masterGainDb: -3, masterEffects: structuredClone(DEFAULT_EFFECT_CHAIN),
        masterMode: "binaural", selectedLaneId: "restore-lane-1",
      },
    };
    await hydrateProject(parseProjectJson(JSON.stringify(fixture)));
    expect(useMixer.getState().masterGainDb).toBe(-3);
    expect(useMixer.getState().masterMode).toBe("binaural");
    expect(useMixer.getState().lanes[0].gainDb).toBe(-4);
    expect(useTracks.getState().tracks[0].status).toBe("error");
    expect(useTracks.getState().tracks[0].file.size).toBe(0);
    expect(serializeProject().mixer.lanes[0].id).toBe("restore-lane-1");
    useTracks.getState().clearAll();
    useMixer.getState().clearAllLanes();
  });

});
