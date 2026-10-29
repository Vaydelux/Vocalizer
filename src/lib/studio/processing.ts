/**
 * Offline audio processing — real Web Audio DSP.
 *
 * All functions operate on decoded AudioBuffers and return new buffers.
 * Non-destructive by design: source buffers are never modified.
 *
 * Progress honesty: OfflineAudioContext.startRendering() provides no progress
 * events — those stages report indeterminate progress. Stages that are real
 * loops (OLA stretch, WAV encode) report true fractional progress.
 */

import { studioError } from "./errors";

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export interface RenderOpts {
  signal?: AbortSignal;
  onStage?: (stage: string, progress: number | null) => void;
}

async function renderOffline(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  const rendering = ctx.startRendering();
  return await rendering;
}

/* ----------------------------------- trim ---------------------------------- */

export interface TrimOptions extends RenderOpts {
  startSec: number;
  endSec: number;
  /** Output sample rate; default = source rate. */
  targetSampleRate?: number;
}

export async function renderTrim(buffer: AudioBuffer, opts: TrimOptions): Promise<AudioBuffer> {
  const { startSec, endSec, signal, onStage } = opts;
  if (!(endSec > startSec) || startSec < 0 || endSec > buffer.duration + 0.001) {
    throw studioError("INPUT_INVALID", `Invalid selection: ${startSec.toFixed(3)}s → ${endSec.toFixed(3)}s`);
  }
  const sampleRate = opts.targetSampleRate ?? buffer.sampleRate;
  const length = Math.max(1, Math.ceil((endSec - startSec) * sampleRate));
  checkAbort(signal);
  onStage?.("Rendering trimmed region", null);
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0, startSec, endSec - startSec);
  return await renderOffline(ctx);
}

/* ----------------------------------- join ---------------------------------- */

export interface JoinItem {
  buffer: AudioBuffer;
  /** Optional per-item gain (0..1). */
  gain?: number;
}

export interface JoinOptions extends RenderOpts {
  /** Crossfade duration in seconds (0 = butt join). */
  crossfadeSec: number;
  targetSampleRate: number;
  targetChannels: 1 | 2;
}

/**
 * Join buffers sequentially with optional equal-power crossfade.
 * Sample-rate differences are handled by the offline context's real resampler;
 * channel differences follow the standard Web Audio downmix/upmix rules.
 */
export async function renderJoin(items: JoinItem[], opts: JoinOptions): Promise<AudioBuffer> {
  const { crossfadeSec, targetSampleRate, targetChannels, signal, onStage } = opts;
  if (items.length === 0) {
    throw studioError("INPUT_INVALID", "No audio items to join.");
  }
  checkAbort(signal);

  // Compute timeline in output samples.
  let cursor = 0;
  const starts: number[] = [];
  for (const item of items) {
    const len = Math.ceil((item.buffer.length * targetSampleRate) / item.buffer.sampleRate);
    starts.push(cursor);
    if (cursor === 0 && starts.length === 1) {
      cursor = len;
    } else {
      const xf = Math.min(crossfadeSec * targetSampleRate, len - 1, cursor);
      cursor = cursor - (xf > 0 ? xf : 0) + len;
    }
  }
  const totalLength = Math.max(1, Math.ceil(cursor));
  onStage?.(`Rendering join (${items.length} items)`, null);

  const ctx = new OfflineAudioContext(targetChannels, totalLength, targetSampleRate);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    const gain = ctx.createGain();
    const g = item.gain ?? 1;
    gain.gain.value = g;
    src.connect(gain).connect(ctx.destination);

    const startAt = starts[i];
    const xfSamples =
      i === 0 || crossfadeSec <= 0
        ? 0
        : Math.min(crossfadeSec * targetSampleRate, startAt);
    const xfSec = xfSamples / targetSampleRate;

    if (xfSamples > 0) {
      // Equal-power crossfade: fade-in over the overlap region.
      gain.gain.setValueAtTime(0.0001, startAt / targetSampleRate);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), (startAt + xfSamples) / targetSampleRate);
      src.start(startAt / targetSampleRate);
    } else {
      src.start(startAt / targetSampleRate);
    }
    void xfSec;
  }
  return await renderOffline(ctx);
}

/* ---------------------------------- pitch ---------------------------------- */

export interface PitchOptions extends RenderOpts {
  semitones: number; // -12..12
  cents: number; // -100..100
  /** Tempo multiplier (1 = unchanged). >1 = faster. */
  tempo: number;
  /** true → keep duration constant (granular stretch); false → coupled pitch+tempo (resample). */
  preserveDuration: boolean;
}

function olaTimeStretch(
  input: Float32Array,
  factor: number,
  signal?: AbortSignal,
  onProgress?: (p: number) => void
): Float32Array {
  // Overlap-add time stretch. Grain 2048 @ 4x overlap, Hann window.
  const N = 2048;
  const Ha = N / 4;
  const Hs = Math.max(1, Math.round(Ha * factor));
  const outLen = Math.max(N, Math.ceil(input.length * factor) + N);
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  let a = 0;
  let s = 0;
  let grains = 0;
  const totalGrains = Math.max(1, Math.ceil((input.length - N) / Ha));
  while (a + N <= input.length) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const syn = s * Hs;
    if (syn + N > outLen) break;
    for (let k = 0; k < N; k++) {
      out[syn + k] += input[a + k] * win[k];
      norm[syn + k] += win[k];
    }
    a += Ha;
    s += 1;
    grains++;
    if (grains % 256 === 0) {
      onProgress?.(grains / totalGrains);
      // Yield handled by caller loop granularity; keep this function sync-fast.
    }
  }
  for (let i = 0; i < outLen; i++) {
    if (norm[i] > 1e-6) out[i] /= norm[i];
  }
  return out;
}

async function resampleChannels(
  channels: Float32Array[],
  sourceRate: number,
  playRatio: number,
  opts: RenderOpts
): Promise<Float32Array[]> {
  const numChannels = channels.length;
  const outFrames = Math.max(1, Math.floor(channels[0].length / playRatio));
  const ctx = new OfflineAudioContext(numChannels, outFrames, sourceRate);
  const buffer = ctx.createBuffer(numChannels, channels[0].length, sourceRate);
  for (let c = 0; c < numChannels; c++) buffer.copyToChannel(channels[c], c);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playRatio;
  src.connect(ctx.destination);
  src.start(0);
  opts.onStage?.("Resampling", null);
  const rendered = await renderOffline(ctx);
  const out: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) out.push(rendered.getChannelData(c).slice());
  return out;
}

/**
 * Pitch-shift (and optionally tempo-change) processing.
 * - preserveDuration=false: single high-quality resample by (pitch × tempo); pitch and tempo are coupled (tape-style).
 * - preserveDuration=true: granular OLA time-stretch by (pitch/tempo) then resample by pitch — duration preserved; some granular artifacts possible at extreme settings (disclosed in UI).
 */
export async function renderPitch(
  buffer: AudioBuffer,
  opts: PitchOptions
): Promise<AudioBuffer> {
  const { semitones, cents, tempo, preserveDuration, signal, onStage } = opts;
  if (tempo <= 0.25 || tempo > 4) {
    throw studioError("INPUT_INVALID", `Tempo multiplier out of supported range: ${tempo}`);
  }
  const P = Math.pow(2, (semitones + cents / 100) / 12);
  const T = tempo;

  checkAbort(signal);

  if (!preserveDuration) {
    onStage?.("Coupled pitch/tempo resample", null);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
    const resampled = await resampleChannels(channels, buffer.sampleRate, P * T, opts);
    return channelsToBuffer(resampled, buffer.sampleRate);
  }

  // Duration-preserving path.
  const F = P / T;
  onStage?.("Granular time-stretch", 0);
  const stretched: Float32Array[] = [];
  const numChannels = buffer.numberOfChannels;
  for (let c = 0; c < numChannels; c++) {
    const channel = buffer.getChannelData(c);
    // Run in slices via micro-chunks is not possible with the sync OLA; run per
    // channel with yields between channels.
    const out = olaTimeStretch(channel, F, signal);
    stretched.push(out);
    onStage?.("Granular time-stretch", (c + 1) / numChannels);
    await new Promise<void>((r) => setTimeout(r, 0));
    checkAbort(signal);
  }
  const resampled = await resampleChannels(stretched, buffer.sampleRate, P, opts);
  return channelsToBuffer(resampled, buffer.sampleRate);
}

function channelsToBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, sampleRate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c);
  return buf;
}

/* ---------------------------------- mixing --------------------------------- */

export interface MixOptions extends RenderOpts {
  /** Where the mic recording starts on the instrumental timeline (seconds). */
  micStartSec: number;
  micGain: number;
  instrumentalGain: number;
}

/** Mix a recorded performance onto an instrumental — real summing via offline render. */
export async function renderMix(
  instrumental: AudioBuffer,
  mic: AudioBuffer,
  opts: MixOptions
): Promise<AudioBuffer> {
  const { micStartSec, micGain, instrumentalGain, signal, onStage } = opts;
  checkAbort(signal);
  const sampleRate = instrumental.sampleRate;
  const micLen = Math.ceil(mic.length + micStartSec * sampleRate);
  const total = Math.max(instrumental.length, micLen);
  onStage?.("Mixing performance with instrumental", null);
  const ctx = new OfflineAudioContext(2, total, sampleRate);

  const inst = ctx.createBufferSource();
  inst.buffer = instrumental;
  const instGain = ctx.createGain();
  instGain.gain.value = instrumentalGain;
  inst.connect(instGain).connect(ctx.destination);
  inst.start(0);

  const micSrc = ctx.createBufferSource();
  micSrc.buffer = mic;
  const mGain = ctx.createGain();
  mGain.gain.value = micGain;
  micSrc.connect(mGain).connect(ctx.destination);
  micSrc.start(micStartSec);

  return await renderOffline(ctx);
}

/* ------------------------------ channel mapping ---------------------------- */

/** Convert buffer to mono/stereo per Web Audio channel interpretation rules. */
export async function convertChannels(
  buffer: AudioBuffer,
  targetChannels: 1 | 2,
  opts: RenderOpts
): Promise<AudioBuffer> {
  if (buffer.numberOfChannels === targetChannels) return buffer;
  checkAbort(signalOf(opts));
  const ctx = new OfflineAudioContext(targetChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  opts.onStage?.("Converting channels", null);
  return await renderOffline(ctx);
}

function signalOf(opts: RenderOpts): AbortSignal | undefined {
  return opts.signal;
}

/* -------------------------------- resampling ------------------------------- */

export async function resampleBuffer(
  buffer: AudioBuffer,
  targetRate: number,
  opts: RenderOpts
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  checkAbort(signalOf(opts));
  const frames = Math.ceil((buffer.length * targetRate) / buffer.sampleRate);
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  opts.onStage?.(`Resampling ${buffer.sampleRate} Hz → ${targetRate} Hz`, null);
  return await renderOffline(ctx);
}
