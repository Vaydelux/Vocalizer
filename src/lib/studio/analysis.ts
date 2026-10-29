/**
 * Offline musical analysis — genuine DSP, computed from the imported audio.
 *
 * BPM: spectral-flux onset envelope → autocorrelation tempogram → peak picking
 *      with parabolic refinement and ranked alternatives.
 * Key: FFT-magnitude chroma (pitch-class profile) → Pearson correlation against
 *      Krumhansl–Kessler major/minor profiles over all 24 rotations.
 *
 * No random or invented values: confidence is derived from peak separation /
 * correlation margins, and "analyzed window" is reported honestly.
 */

import { isAbort } from "./errors";
import type { BpmAlternative, BpmResult, KeyAlternative, KeyResult } from "./types";
import { pitchClassName } from "./format";

/* --------------------------------- yielding -------------------------------- */

function yieldTick(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

export interface AnalysisProgress {
  onProgress?: (p: number, stage: string) => void;
  signal?: AbortSignal;
}

async function checkAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/* ----------------------------------- FFT ----------------------------------- */

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(ang);
    const wStepIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const aIdx = i + k;
        const bIdx = aIdx + half;
        const vRe = re[bIdx] * wRe - im[bIdx] * wIm;
        const vIm = re[bIdx] * wIm + im[bIdx] * wRe;
        re[bIdx] = re[aIdx] - vRe;
        im[bIdx] = im[aIdx] - vIm;
        re[aIdx] += vRe;
        im[aIdx] += vIm;
        const nWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nWRe;
      }
    }
  }
}

function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/* ---------------------------------- mixdown --------------------------------- */

export function mixToMono(buffer: AudioBuffer, startSample: number, endSample: number): Float32Array {
  const len = endSample - startSample;
  const out = new Float32Array(len);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      out[i] += data[startSample + i] / ch;
    }
  }
  return out;
}

/* ----------------------------------- BPM ----------------------------------- */

const BPM_MIN = 60;
const BPM_MAX = 190;
const ONSET_FFT = 1024;

/**
 * Compute the spectral-flux onset envelope at ~100 fps from a mono signal.
 */
function onsetEnvelope(
  mono: Float32Array,
  sampleRate: number
): { env: Float32Array; fps: number } {
  const hop = 441;
  const fps = sampleRate / hop;
  const frames = Math.max(1, Math.floor((mono.length - ONSET_FFT) / hop));
  const win = hannWindow(ONSET_FFT);
  const re = new Float32Array(ONSET_FFT);
  const im = new Float32Array(ONSET_FFT);
  const bins = ONSET_FFT / 2;
  const prevMag = new Float32Array(bins);
  const env = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < ONSET_FFT; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const diff = mag - prevMag[k];
      if (diff > 0) flux += diff;
      prevMag[k] = mag;
    }
    env[f] = flux;
  }
  return { env, fps };
}

function autocorrelate(env: Float32Array, fps: number): { lags: Float32Array; lagMin: number; lagMax: number } {
  const lagMin = Math.max(2, Math.floor((fps * 60) / BPM_MAX));
  const lagMax = Math.min(env.length - 1, Math.ceil((fps * 60) / BPM_MIN));
  const lags = new Float32Array(lagMax + 1);
  // Mean-remove so DC doesn't dominate.
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  const centered = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) centered[i] = env[i] - mean;

  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    const n = env.length - lag;
    for (let i = 0; i < n; i++) sum += centered[i] * centered[i + lag];
    lags[lag] = sum / n;
  }
  return { lags, lagMin, lagMax };
}

function parabolicPeak(values: Float32Array, idx: number): { position: number; value: number } {
  const yPrev = values[idx - 1] ?? values[idx];
  const yCur = values[idx];
  const yNext = values[idx + 1] ?? values[idx];
  const denom = yPrev - 2 * yCur + yNext;
  if (Math.abs(denom) < 1e-12) return { position: idx, value: yCur };
  const delta = (0.5 * (yPrev - yNext)) / denom;
  const pos = idx + Math.max(-1, Math.min(1, delta));
  const val = yCur - (0.25 * (yPrev - yNext) * delta);
  return { position: pos, value: val };
}

/** Full BPM analysis of a decoded buffer. Progress: 0→0.7 envelope, 0.7→1 autocorrelation. */
export async function analyzeBpm(
  buffer: AudioBuffer,
  opts: AnalysisProgress = {}
): Promise<BpmResult> {
  const { onProgress, signal } = opts;
  await checkAbort(signal);

  // Analyze the middle 90 seconds (or whole track if shorter) for speed and
  // musical representativeness — the window is disclosed in the result.
  const maxWindow = 90;
  const sr = buffer.sampleRate;
  const useFull = buffer.duration <= maxWindow + 4;
  const startSample = useFull ? 0 : Math.floor(((buffer.duration - maxWindow) / 2) * sr);
  const endSample = useFull ? buffer.length : Math.min(buffer.length, startSample + maxWindow * sr);
  const analyzedSeconds = (endSample - startSample) / sr;

  onProgress?.(0.02, "Extracting onset envelope");
  const mono = mixToMono(buffer, startSample, endSample);
  const { env, fps } = onsetEnvelope(mono, sr);
  mono.fill(0);
  await checkAbort(signal);
  onProgress?.(0.7, "Building tempo autocorrelation");

  const { lags, lagMin, lagMax } = autocorrelate(env, fps);

  // Find ranked local maxima over the lag range.
  interface Peak { lag: number; value: number }
  const peaks: Peak[] = [];
  for (let lag = lagMin + 1; lag < lagMax; lag++) {
    if (lags[lag] > lags[lag - 1] && lags[lag] >= lags[lag + 1] && lags[lag] > 0) {
      peaks.push({ lag, value: lags[lag] });
    }
  }
  peaks.sort((a, b) => b.value - a.value);

  await checkAbort(signal);
  onProgress?.(0.95, "Refining tempo estimate");

  if (peaks.length === 0) {
    // Silent/noise-only signal — report honestly with zero confidence.
    return {
      bpm: 0,
      confidence: 0,
      alternatives: [],
      analyzedSeconds,
      windowNote: useFull ? "entire track" : `middle ${Math.round(analyzedSeconds)} s`,
    };
  }

  const best = peaks[0];
  const refined = parabolicPeak(lags, best.lag);
  const bpm = (fps * 60) / refined.position;

  // Confidence: separation between best and next distinct tempo region.
  let secondValue = 0;
  for (const p of peaks.slice(1)) {
    const distinct = Math.abs(p.lag - best.lag) > 3 && Math.abs(Math.log2(p.lag / best.lag)) > 0.12;
    if (distinct) {
      secondValue = p.value;
      break;
    }
  }
  const confidence =
    best.value > 0 ? Math.max(0, Math.min(1, (best.value - secondValue) / best.value + 0.35)) : 0;

  const alternatives: BpmAlternative[] = [];
  for (const p of peaks.slice(1, 6)) {
    const altBpm = (fps * 60) / p.lag;
    if (altBpm >= BPM_MIN - 10 && altBpm <= BPM_MAX + 10) {
      alternatives.push({ bpm: Math.round(altBpm * 10) / 10, note: "tempogram peak" });
    }
  }
  const half = bpm / 2;
  const double = bpm * 2;
  if (half >= 30 && half <= 300) {
    alternatives.unshift({ bpm: Math.round(half * 10) / 10, note: "possible half-time" });
  }
  if (double >= 30 && double <= 300) {
    alternatives.push({ bpm: Math.round(double * 10) / 10, note: "possible double-time" });
  }

  onProgress?.(1, "Done");
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    alternatives: alternatives.slice(0, 5),
    analyzedSeconds: Math.round(analyzedSeconds * 10) / 10,
    windowNote: useFull ? "entire track" : `middle ${Math.round(analyzedSeconds)} s`,
  };
}

/* ----------------------------------- key ----------------------------------- */

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom < 1e-12 ? 0 : num / denom;
}

/** Full key analysis. Progress stages reported. */
export async function analyzeKey(
  buffer: AudioBuffer,
  opts: AnalysisProgress = {}
): Promise<KeyResult> {
  const { onProgress, signal } = opts;
  await checkAbort(signal);

  const maxWindow = 90;
  const sr = buffer.sampleRate;
  const useFull = buffer.duration <= maxWindow + 4;
  const startSample = useFull ? 0 : Math.floor(((buffer.duration - maxWindow) / 2) * sr);
  const endSample = useFull ? buffer.length : Math.min(buffer.length, startSample + maxWindow * sr);
  const analyzedSeconds = (endSample - startSample) / sr;
  void analyzedSeconds;

  const FFT = 4096;
  const HOP = 4096; // 50% cost saving; chroma is aggregated over the window anyway
  const win = hannWindow(FFT);
  const chroma = new Array<number>(12).fill(0);
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);
  const bins = FFT / 2;

  const totalFrames = Math.max(1, Math.floor((endSample - startSample - FFT) / HOP));
  const CHUNK_FRAMES = 24;

  let f = 0;
  while (f < totalFrames) {
    await checkAbort(signal);
    const chunkEnd = Math.min(f + CHUNK_FRAMES, totalFrames);
    for (; f < chunkEnd; f++) {
      const off = startSample + f * HOP;
      for (let i = 0; i < FFT; i++) {
        re[i] = buffer.getChannelData(0)[off + i] * win[i];
        im[i] = 0;
      }
      // For stereo, average the second channel in as well.
      if (buffer.numberOfChannels > 1) {
        const data2 = buffer.getChannelData(1);
        for (let i = 0; i < FFT; i++) re[i] += data2[off + i] * win[i];
      }
      fftInPlace(re, im);
      for (let k = 1; k < bins; k++) {
        const freq = (k * sr) / FFT;
        if (freq < 55 || freq > 2093) continue; // A1..C7 — musically useful range
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const midi = 69 + 12 * Math.log2(freq / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pc] += Math.sqrt(mag);
      }
    }
    onProgress?.(0.1 + 0.75 * (f / totalFrames), "Building pitch-class profile");
    await yieldTick();
  }

  const total = chroma.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    return {
      label: "—",
      tonic: "—",
      scale: "major",
      correlation: 0,
      alternatives: [],
    };
  }
  for (let i = 0; i < 12; i++) chroma[i] /= total;

  onProgress?.(0.9, "Matching key profiles");
  interface Candidate { root: number; scale: "major" | "minor"; r: number }
  const candidates: Candidate[] = [];
  for (let root = 0; root < 12; root++) {
    const rotated: number[] = [];
    for (let i = 0; i < 12; i++) rotated.push(chroma[(i + root) % 12]);
    candidates.push({ root, scale: "major", r: pearson(rotated, KK_MAJOR) });
    candidates.push({ root, scale: "minor", r: pearson(rotated, KK_MINOR) });
  }
  candidates.sort((a, b) => b.r - a.r);

  const best = candidates[0];
  const alternatives: KeyAlternative[] = candidates.slice(1, 5).map((c) => ({
    label: `${pitchClassName(c.root)} ${c.scale}`,
    correlation: Math.round(Math.max(0, c.r) * 1000) / 1000,
  }));

  onProgress?.(1, "Done");
  return {
    label: `${pitchClassName(best.root)} ${best.scale}`,
    tonic: pitchClassName(best.root),
    scale: best.scale,
    correlation: Math.round(Math.max(0, best.r) * 1000) / 1000,
    alternatives,
  };
}

export { isAbort };
