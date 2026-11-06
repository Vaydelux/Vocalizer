"use client";

/**
 * Job task factories — each returns a real, cancellable task that produces a
 * verified output file. Heavy work (decode → DSP → encode) runs inside the
 * processing queue, off the render path, with honest progress.
 */

import type { JobCtx, JobResultFile, ExportFormat, Mp3Bitrate } from "./types";
import type { AudioTrack } from "./types";
import { decodeFile } from "./decode";
import { encodeAudio } from "./encode";
import { renderTrim, renderJoin, renderPitch, renderMix, convertChannels } from "./processing";
import { analyzeBpm, analyzeKey } from "./analysis";
import { useSettings } from "./store-settings";
import type { SampleRatePref } from "./types";
import { useAnalysis } from "./store-analysis";
import { baseName, sanitizeFileName, timestampSlug } from "./format";
import { studioError } from "./errors";
import { isNative } from "./native";
import { hasUsableTrackAudio } from "./native-stem-track";
import { nativeTrimTask, nativeJoinTask, nativePitchTask, nativeConvertTask, nativeMixTask, nativeMultitrackTask } from "./native-tasks";
import { buildFfmpegDspFilters, type DspEffectChain } from "./dsp-effects";
import { buildSpatialAudioFilter, createSpatialPannerNode, type SpatialPosition } from "./spatial-audio";
import { compileAutomationToFfmpegFilter, type AutomationLane } from "./automation";

interface FormatOverride {
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

function resolveFormat(override?: FormatOverride): { format: ExportFormat; mp3Bitrate: Mp3Bitrate } {
  const s = useSettings.getState();
  return {
    format: override?.format ?? s.exportFormat,
    mp3Bitrate: override?.mp3Bitrate ?? s.mp3Bitrate,
  };
}

function resolveSampleRate(pref: SampleRatePref, sourceRate: number): number {
  return pref === "auto" ? sourceRate : pref;
}

function outName(source: string, op: string): string {
  // Returns a filename base (no extension); the encoder appends the correct ext.
  return `${sanitizeFileName(baseName(source))}_${op}_${timestampSlug()}`;
}

async function encodeStep(
  ctx: JobCtx,
  buffer: AudioBuffer,
  nameBase: string,
  fromProgress: number,
  toProgress: number,
  override?: FormatOverride
): Promise<JobResultFile> {
  const { format, mp3Bitrate } = resolveFormat(override);
  const stageLabel = format === "mp3" ? "Encoding MP3" : "Encoding WAV";
  ctx.reportProgress(fromProgress, stageLabel);
  const { blob, mime, ext } = await encodeAudio(buffer, {
    format,
    mp3Bitrate,
    signal: ctx.signal,
    onProgress: (p) => ctx.reportProgress(fromProgress + (toProgress - fromProgress) * p, stageLabel),
  });
  if (blob.size === 0) {
    throw studioError("OUTPUT_EMPTY", `Encoded output for ${nameBase} is empty.`);
  }
  return { name: `${nameBase}.${ext}`, size: blob.size, url: URL.createObjectURL(blob), mime };
}

/* ----------------------------------- trim ---------------------------------- */

export interface TrimTaskInput {
  track: AudioTrack;
  startSec: number;
  endSec: number;
  lossless?: boolean;
  loudnessNormalize?: { targetLufs: number; truePeak: number };
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeTrimTask(input: TrimTaskInput) {
  if (isNative()) {
    return (ctx: JobCtx) => nativeTrimTask(
      {
        track: input.track,
        startSec: input.startSec,
        endSec: input.endSec,
        lossless: input.lossless,
        loudnessNormalize: input.loudnessNormalize,
        override: { format: input.format, mp3Bitrate: input.mp3Bitrate },
      },
      ctx
    );
  }
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const { track, startSec, endSec } = input;
    ctx.log(`Decoding ${track.name}…`);
    const { buffer } = await decodeFile(track.file, ctx.signal);
    const targetRate = resolveSampleRate(useSettings.getState().sampleRate, buffer.sampleRate);
    ctx.log(`Source: ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate} Hz, ${buffer.numberOfChannels} ch`);
    const rendered = await renderTrim(buffer, {
      startSec,
      endSec,
      targetSampleRate: targetRate,
      signal: ctx.signal,
      onStage: (stage, p) => ctx.reportProgress(p, stage),
    });
    ctx.log(`Trimmed region: ${(endSec - startSec).toFixed(3)}s → ${rendered.length} samples @ ${targetRate} Hz`);
    return await encodeStep(ctx, rendered, outName(track.name, "cut"), 0.8, 1, input);
  };
}

/* ----------------------------------- join ---------------------------------- */

export interface JoinTaskInput {
  tracks: AudioTrack[];
  crossfadeSec: number;
  sampleRatePref: SampleRatePref;
  channels: 1 | 2 | "auto";
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeJoinTask(input: JoinTaskInput) {
  if (isNative()) {
    return (ctx: JobCtx) => nativeJoinTask(
      { tracks: input.tracks, crossfadeSec: input.crossfadeSec, override: { format: input.format, mp3Bitrate: input.mp3Bitrate } },
      ctx
    );
  }
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const { tracks, crossfadeSec, channels } = input;
    const buffers: AudioBuffer[] = [];
    for (let i = 0; i < tracks.length; i++) {
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
      ctx.reportProgress((0.7 * i) / tracks.length, `Decoding ${i + 1}/${tracks.length}`);
      ctx.log(`Decoding ${tracks[i].name}…`);
      const { buffer } = await decodeFile(tracks[i].file, ctx.signal);
      buffers.push(buffer);
    }
    const first = buffers[0];
    const targetRate =
      input.sampleRatePref === "auto" ? first.sampleRate : input.sampleRatePref;
    const targetChannels: 1 | 2 = channels === "auto" ? (first.numberOfChannels === 1 ? 1 : 2) : channels;

    ctx.log(
      `Normalizing output to ${targetRate} Hz / ${targetChannels} ch; crossfade ${crossfadeSec.toFixed(1)}s.`
    );
    const rendered = await renderJoin(
      buffers.map((b) => ({ buffer: b })),
      {
        crossfadeSec,
        targetSampleRate: targetRate,
        targetChannels,
        signal: ctx.signal,
        onStage: (stage, p) => ctx.reportProgress(p, stage),
      }
    );
    const normalized = await convertChannels(rendered, targetChannels, { signal: ctx.signal });
    ctx.log(`Joined output: ${normalized.duration.toFixed(2)}s`);
    return await encodeStep(ctx, normalized, outName(tracks.map((t) => baseName(t.name)).join("+"), "join"), 0.75, 1, input);
  };
}

/* ---------------------------------- pitch ---------------------------------- */

export interface PitchTaskInput {
  track: AudioTrack;
  semitones: number;
  cents: number;
  tempo: number;
  preserveDuration: boolean;
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makePitchTask(input: PitchTaskInput) {
  if (isNative()) {
    return (ctx: JobCtx) => nativePitchTask(
      { track: input.track, semitones: input.semitones, cents: input.cents, tempo: input.tempo, preserveDuration: input.preserveDuration, override: { format: input.format, mp3Bitrate: input.mp3Bitrate } },
      ctx
    );
  }
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const { track } = input;
    ctx.log(`Decoding ${track.name}…`);
    const { buffer } = await decodeFile(track.file, ctx.signal);
    ctx.log(
      `Pitch ${input.semitones >= 0 ? "+" : ""}${input.semitones} st ${input.cents >= 0 ? "+" : ""}${input.cents} cents, tempo ×${input.tempo}, ${input.preserveDuration ? "duration-preserving (granular)" : "coupled (tape-style)"}`
    );
    const rendered = await renderPitch(buffer, {
      semitones: input.semitones,
      cents: input.cents,
      tempo: input.tempo,
      preserveDuration: input.preserveDuration,
      signal: ctx.signal,
      onStage: (stage, p) => ctx.reportProgress(p, stage),
    });
    ctx.log(`Output duration: ${rendered.duration.toFixed(2)}s (source ${buffer.duration.toFixed(2)}s)`);
    const suffix = `pitch${input.semitones >= 0 ? "+" : ""}${input.semitones}${input.tempo !== 1 ? `_x${input.tempo}` : ""}`;
    return await encodeStep(ctx, rendered, outName(track.name, suffix), 0.85, 1, input);
  };
}

/* --------------------------- recording → wav convert ------------------------ */

export interface ConvertTaskInput {
  file: File;
  friendlyName: string;
  sampleRateHint?: number;
  sampleRate?: 44100 | 48000 | null;
  loudnessNormalize?: { targetLufs: number; truePeak: number };
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeConvertTask(input: ConvertTaskInput) {
  if (isNative()) {
    return (ctx: JobCtx) => nativeConvertTask(
      {
        file: input.file,
        friendlyName: input.friendlyName,
        sampleRate: input.sampleRate,
        loudnessNormalize: input.loudnessNormalize,
        override: { format: input.format, mp3Bitrate: input.mp3Bitrate },
      },
      ctx
    );
  }
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const fmt = input.format ?? useSettings.getState().exportFormat;
    ctx.log(`Converting ${input.friendlyName} to ${fmt.toUpperCase()}…`);
    const { buffer } = await decodeFile(input.file, ctx.signal);
    ctx.log(`Decoded: ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate} Hz, ${buffer.numberOfChannels} ch`);
    return await encodeStep(ctx, buffer, outName(input.friendlyName, "recording"), 0.2, 1, input);
  };
}

/* ----------------------------------- mix ----------------------------------- */

export interface MixTaskInput {
  instrumental: AudioTrack;
  micFile: File;
  micStartSec: number;
  micGain: number;
  instrumentalGain: number;
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeMixTask(input: MixTaskInput) {
  if (isNative()) {
    return (ctx: JobCtx) => nativeMixTask(
      { instrumental: input.instrumental, micFile: input.micFile, micStartSec: input.micStartSec, override: { format: input.format, mp3Bitrate: input.mp3Bitrate } },
      ctx
    );
  }
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    ctx.log(`Decoding instrumental ${input.instrumental.name}…`);
    const inst = await decodeFile(input.instrumental.file, ctx.signal);
    ctx.reportProgress(0.15, "Decoding performance");
    ctx.log(`Decoding recorded performance…`);
    const mic = await decodeFile(input.micFile, ctx.signal);
    ctx.log(
      `Mixing performance (starts at ${input.micStartSec.toFixed(2)}s, gain ×${input.micGain}) with instrumental (gain ×${input.instrumentalGain}).`
    );
    const mixed = await renderMix(inst.buffer, mic.buffer, {
      micStartSec: input.micStartSec,
      micGain: input.micGain,
      instrumentalGain: input.instrumentalGain,
      signal: ctx.signal,
      onStage: (stage, p) => ctx.reportProgress(0.3 + 0.4 * (p ?? 0.5), stage),
    });
    return await encodeStep(ctx, mixed, outName(input.instrumental.name, "karaoke-mix"), 0.75, 1, input);
  };
}

/* --------------------------------- analysis -------------------------------- */

export interface AnalysisTaskInput {
  track: AudioTrack;
}

export function makeBpmTask(input: AnalysisTaskInput) {
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const { track } = input;
    ctx.log(`Decoding ${track.name} for tempo analysis…`);
    ctx.reportProgress(0.05, "Decoding");
    const { buffer } = await decodeFile(track.file, ctx.signal);
    ctx.log(`Analyzing tempo (onset autocorrelation)…`);
    const result = await analyzeBpm(buffer, {
      signal: ctx.signal,
      onProgress: (p, stage) => ctx.reportProgress(0.1 + 0.85 * p, stage),
    });
    useAnalysis.getState().storeBpm(track.id, result);
    ctx.log(
      result.bpm > 0
        ? `Estimated ${result.bpm} BPM (confidence ${(result.confidence * 100).toFixed(0)}%), window: ${result.windowNote}.`
        : "No usable tempo peak found (silent or noise-only signal). Confidence 0 — nothing invented."
    );
    const json = JSON.stringify({ track: track.name, ...result }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    return { name: `${outName(track.name, "bpm")}.json`, size: blob.size, url: URL.createObjectURL(blob), mime: "application/json" };
  };
}

export function makeKeyTask(input: AnalysisTaskInput) {
  return async (ctx: JobCtx): Promise<JobResultFile> => {
    const { track } = input;
    ctx.log(`Decoding ${track.name} for key analysis…`);
    ctx.reportProgress(0.05, "Decoding");
    const { buffer } = await decodeFile(track.file, ctx.signal);
    ctx.log("Analyzing key (chroma × Krumhansl–Kessler profiles)…");
    const result = await analyzeKey(buffer, {
      signal: ctx.signal,
      onProgress: (p, stage) => ctx.reportProgress(0.1 + 0.85 * p, stage),
    });
    useAnalysis.getState().storeKey(track.id, result);
    ctx.log(`Estimated key: ${result.label} (r = ${result.correlation}).`);
    const json = JSON.stringify({ track: track.name, ...result }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    return { name: `${outName(track.name, "key")}.json`, size: blob.size, url: URL.createObjectURL(blob), mime: "application/json" };
  };
}

/* -------------------------------- multitrack ------------------------------- */

export interface MultitrackTaskInput {
  lanes: Array<{
    track: AudioTrack;
    offsetSec: number;
    gainDb: number;
    pan: number;
    effects?: DspEffectChain;
    spatialEnabled?: boolean;
    spatialPosition?: SpatialPosition;
    automationLanes?: AutomationLane[];
  }>;
  masterGainDb: number;
  masterEffects?: DspEffectChain;
  masterMode?: "stereo" | "binaural" | "surround51";
  loudnessNormalize?: { targetLufs: number; truePeak: number };
  defaultName?: string;
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeMultitrackTask(input: MultitrackTaskInput) {
  // Protect both renderer and native callers from silently exporting an
  // incomplete mix after project metadata was restored without audio files.
  if (input.lanes.length === 0 || input.lanes.some(({ track }) =>
    !hasUsableTrackAudio(track)
  )) {
    return async (_ctx: JobCtx): Promise<JobResultFile> => {
      throw studioError("MISSING_FILE", "One or more mixer tracks are unavailable. Relink and validate source media before exporting.");
    };
  }
  if (isNative()) {
    return (ctx: JobCtx) =>
      nativeMultitrackTask(
        {
          lanes: input.lanes.map((l) => {
            const dspFilters = l.effects ? buildFfmpegDspFilters(l.effects) : [];
            const spatialFilters =
              l.spatialEnabled && l.spatialPosition
                ? buildSpatialAudioFilter(
                    l.spatialPosition,
                    input.masterMode === "surround51" ? "surround51" : "binaural"
                  )
                : [];
            const autoFilters: string[] = [];
            if (l.automationLanes && l.automationLanes.length > 0) {
              for (const al of l.automationLanes) {
                if (al.enabled && al.points.length > 0) {
                  const f = compileAutomationToFfmpegFilter(al.target, al.points);
                  if (f) autoFilters.push(f);
                }
              }
            }
            const allFilters = [...dspFilters, ...spatialFilters, ...autoFilters];
            return {
              track: l.track,
              offsetSec: l.offsetSec,
              gainDb: l.gainDb,
              pan: l.pan,
              filters: allFilters.length > 0 ? allFilters : undefined,
            };
          }),
          masterGainDb: input.masterGainDb,
          masterFilters: input.masterEffects ? buildFfmpegDspFilters(input.masterEffects) : undefined,
          loudnessNormalize: input.loudnessNormalize,
          defaultName: input.defaultName,
          override: { format: input.format, mp3Bitrate: input.mp3Bitrate },
        },
        ctx
      );
  }

  return async (ctx: JobCtx): Promise<JobResultFile> => {
    ctx.log(`Web Audio multitrack mixdown of ${input.lanes.length} lanes (mode: ${input.masterMode ?? "stereo"})…`);
    const buffers: { buffer: AudioBuffer; lane: (typeof input.lanes)[0] }[] = [];
    for (let i = 0; i < input.lanes.length; i++) {
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const lane = input.lanes[i];
      ctx.reportProgress((0.5 * i) / input.lanes.length, `Decoding lane ${i + 1}/${input.lanes.length}`);
      const { buffer } = await decodeFile(lane.track.file, ctx.signal);
      buffers.push({ buffer, lane });
    }

    let maxDuration = 0;
    for (const b of buffers) {
      const end = b.lane.offsetSec + b.buffer.duration;
      if (end > maxDuration) maxDuration = end;
    }
    const sampleRate = 44100;
    const totalSamples = Math.ceil(maxDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, Math.max(1, totalSamples), sampleRate);

    // Master bus
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = Math.pow(10, input.masterGainDb / 20);
    masterGain.connect(offlineCtx.destination);

    for (const b of buffers) {
      const src = offlineCtx.createBufferSource();
      src.buffer = b.buffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = Math.pow(10, b.lane.gainDb / 20);

      src.connect(gain);

      if (b.lane.spatialEnabled && b.lane.spatialPosition) {
        const spatialPanner = createSpatialPannerNode(offlineCtx as unknown as AudioContext, b.lane.spatialPosition);
        gain.connect(spatialPanner);
        spatialPanner.connect(masterGain);
      } else {
        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, b.lane.pan));
        gain.connect(panner);
        panner.connect(masterGain);
      }

      src.start(Math.max(0, b.lane.offsetSec));
    }

    ctx.reportProgress(0.65, "Rendering mixdown");
    const rendered = await offlineCtx.startRendering();
    return await encodeStep(ctx, rendered, outName(input.defaultName ?? "multitrack_master", "bounce"), 0.8, 1, input);
  };
}
