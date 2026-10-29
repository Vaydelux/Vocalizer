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
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeTrimTask(input: TrimTaskInput) {
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
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

export function makeConvertTask(input: ConvertTaskInput) {
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
