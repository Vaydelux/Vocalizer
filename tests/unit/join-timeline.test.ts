import { describe, expect, it } from "bun:test";
import { planJoinTimeline } from "../../electron/shared/join-timeline";
import { buildFfmpegCommand } from "../../electron/main/services/ffmpeg-args";
import { ffmpegOpSchema } from "../../electron/shared/ipc";

describe("joined-audio timeline", () => {
  it("actually overlaps the next clip rather than starting at the prior end", () => {
    const plan = planJoinTimeline([48000, 48000], 4800);
    expect(plan.startFrames).toEqual([0, 43200]);
    expect(plan.overlapFrames).toEqual([4800]);
    expect(plan.totalFrames).toBe(91200);
  });

  it("caps adjacent crossfades so short middle clips are not faded twice at once", () => {
    const plan = planJoinTimeline([48000, 9600, 48000], 24000);
    expect(plan.overlapFrames).toEqual([4800, 4800]);
    expect(plan.startFrames).toEqual([0, 43200, 48000]);
    expect(plan.totalFrames).toBe(96000);
  });

  it("preserves complete duration for a zero-crossfade join", () => {
    const plan = planJoinTimeline([100, 300, 50], 0);
    expect(plan.overlapFrames).toEqual([0, 0]);
    expect(plan.startFrames).toEqual([0, 100, 400]);
    expect(plan.totalFrames).toBe(450);
  });

  it("refuses non-finite, empty and unsafe timelines", () => {
    expect(() => planJoinTimeline([], 0)).toThrow();
    expect(() => planJoinTimeline([0, 10], 0)).toThrow();
    expect(() => planJoinTimeline([1, 2], -1)).toThrow();
    expect(() => planJoinTimeline([1, 2], Number.NaN)).toThrow();
    expect(() => planJoinTimeline([Number.MAX_SAFE_INTEGER, 10], 0)).toThrow();
  });
});

describe("native FFmpeg join filter", () => {
  const base = {
    kind: "join" as const,
    jobId: "join-case",
    inputPaths: ["first.wav", "second.mp3", "third.flac"],
    crossfadeSec: 0.5,
    overlapSeconds: [0.5, 0],
    sampleRate: 44100,
    channels: 1 as const,
    outputFormat: "wav24" as const,
    outputPath: "result.wav",
  };

  it("normalizes sample rates/channels and uses a real FFmpeg crossfade", () => {
    const op = ffmpegOpSchema.parse(base);
    const argv = buildFfmpegCommand(op).argv;
    const filter = argv[argv.indexOf("-filter_complex") + 1];
    expect(filter).toContain("aresample=44100");
    expect(filter).toContain("channel_layouts=mono");
    expect(filter).toContain("acrossfade=d=0.500000:c1=qsin:c2=qsin");
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(argv[argv.indexOf("-map") + 1]).toBe("[joined2]");
    expect(argv[argv.indexOf("-ar") + 1]).toBe("44100");
    expect(argv[argv.indexOf("-ac") + 1]).toBe("1");
    expect(argv[argv.indexOf("-acodec") + 1]).toBe("pcm_s24le");
  });

  it("does not emit an acrossfade when disabled", () => {
    const op = ffmpegOpSchema.parse({
      ...base, inputPaths: ["a.wav", "b.wav"], crossfadeSec: 0,
      overlapSeconds: undefined, channels: 2, sampleRate: 48000,
    });
    const argv = buildFfmpegCommand(op).argv;
    const filter = argv[argv.indexOf("-filter_complex") + 1];
    expect(filter).not.toContain("acrossfade=");
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(filter).toContain("channel_layouts=stereo");
  });

  it("rejects missing per-boundary overlap entries", () => {
    expect(() => buildFfmpegCommand({ ...base, overlapSeconds: [0.1] }))
      .toThrow("one overlap value");
  });
});
