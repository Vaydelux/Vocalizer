/**
 * Dedicated Audio DSP Web Worker and bridge.
 * Offloads heavy mathematical processing (FFT, spectral flux, autocorrelation,
 * chroma profile matching) to a background thread to prevent UI freezing.
 * Gracefully falls back to in-thread calculation if Web Workers are unavailable.
 */

import type { BpmResult, KeyResult, KeyAlternative } from "../types";
import { pitchClassName } from "../format";

const WORKER_SCRIPT = `
self.onmessage = function(e) {
  const { id, type, mono, sampleRate, analyzedSeconds, useFull } = e.data;
  try {
    if (type === "bpm") {
      const result = runBpm(mono, sampleRate, analyzedSeconds, useFull, (p, stage) => {
        self.postMessage({ id, type: "progress", progress: p, stage });
      });
      self.postMessage({ id, type: "result", result });
    } else if (type === "key") {
      const result = runKey(mono, sampleRate, (p, stage) => {
        self.postMessage({ id, type: "progress", progress: p, stage });
      });
      self.postMessage({ id, type: "result", result });
    }
  } catch (err) {
    self.postMessage({ id, type: "error", message: err.message || String(err) });
  }
};

function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
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

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function runBpm(mono, sampleRate, analyzedSeconds, useFull, onProgress) {
  const BPM_MIN = 60;
  const BPM_MAX = 190;
  const ONSET_FFT = 1024;
  const hop = 441;
  const fps = sampleRate / hop;
  const frames = Math.max(1, Math.floor((mono.length - ONSET_FFT) / hop));
  const win = hannWindow(ONSET_FFT);
  const re = new Float32Array(ONSET_FFT);
  const im = new Float32Array(ONSET_FFT);
  const bins = ONSET_FFT / 2;
  const prevMag = new Float32Array(bins);
  const env = new Float32Array(frames);

  onProgress(0.05, "Extracting onset envelope");
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

  onProgress(0.7, "Building tempo autocorrelation");
  const lagMin = Math.max(2, Math.floor((fps * 60) / BPM_MAX));
  const lagMax = Math.min(env.length - 1, Math.ceil((fps * 60) / BPM_MIN));
  const lags = new Float32Array(lagMax + 1);
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

  const peaks = [];
  for (let lag = lagMin + 1; lag < lagMax; lag++) {
    if (lags[lag] > lags[lag - 1] && lags[lag] >= lags[lag + 1] && lags[lag] > 0) {
      peaks.push({ lag, value: lags[lag] });
    }
  }
  peaks.sort((a, b) => b.value - a.value);

  onProgress(0.95, "Refining tempo estimate");
  if (peaks.length === 0) {
    return {
      bpm: 0,
      confidence: 0,
      alternatives: [],
      analyzedSeconds,
      windowNote: useFull ? "entire track" : "middle " + Math.round(analyzedSeconds) + " s",
    };
  }

  const best = peaks[0];
  const yPrev = lags[best.lag - 1] ?? lags[best.lag];
  const yCur = lags[best.lag];
  const yNext = lags[best.lag + 1] ?? lags[best.lag];
  const denom = yPrev - 2 * yCur + yNext;
  const delta = Math.abs(denom) < 1e-12 ? 0 : (0.5 * (yPrev - yNext)) / denom;
  const refinedLag = best.lag + Math.max(-1, Math.min(1, delta));
  const bpm = (fps * 60) / refinedLag;
  const runnerUp = peaks[1];
  const margin = runnerUp ? (best.value - runnerUp.value) / (best.value + 1e-9) : 1;
  const confidence = Math.max(0, Math.min(1, margin * (best.value / (lags[0] || 1 || 1e-9))));

  const alternatives = [];
  for (let i = 1; i < Math.min(peaks.length, 4); i++) {
    const altBpm = (fps * 60) / peaks[i].lag;
    if (Math.abs(altBpm - bpm) > 2) {
      alternatives.push({ bpm: Math.round(altBpm * 10) / 10, note: "tempogram peak" });
    }
  }
  const half = bpm / 2;
  const double = bpm * 2;
  if (half >= 30 && half <= 300) alternatives.unshift({ bpm: Math.round(half * 10) / 10, note: "possible half-time" });
  if (double >= 30 && double <= 300) alternatives.push({ bpm: Math.round(double * 10) / 10, note: "possible double-time" });

  onProgress(1, "Done");
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    alternatives: alternatives.slice(0, 5),
    analyzedSeconds: Math.round(analyzedSeconds * 10) / 10,
    windowNote: useFull ? "entire track" : "middle " + Math.round(analyzedSeconds) + " s",
  };
}

function runKey(mono, sampleRate, onProgress) {
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const FFT = 4096;
  const HOP = 4096;
  const win = hannWindow(FFT);
  const chroma = new Array(12).fill(0);
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);
  const bins = FFT / 2;
  const totalFrames = Math.max(1, Math.floor((mono.length - FFT) / HOP));

  for (let f = 0; f < totalFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = 1; k < bins; k++) {
      const freq = (k * sampleRate) / FFT;
      if (freq < 55 || freq > 2093) continue;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.sqrt(mag);
    }
    if (f % 16 === 0) {
      onProgress(0.1 + 0.75 * (f / totalFrames), "Building pitch-class profile");
    }
  }

  const total = chroma.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    return { label: "—", tonic: "—", scale: "major", correlation: 0, alternatives: [] };
  }
  for (let i = 0; i < 12; i++) chroma[i] /= total;

  onProgress(0.9, "Matching key profiles");
  function pearson(a, b) {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const denom = Math.sqrt(da * db);
    return denom < 1e-12 ? 0 : num / denom;
  }

  const candidates = [];
  for (let root = 0; root < 12; root++) {
    const rotated = [];
    for (let i = 0; i < 12; i++) rotated.push(chroma[(i + root) % 12]);
    candidates.push({ root, scale: "major", r: pearson(rotated, KK_MAJOR) });
    candidates.push({ root, scale: "minor", r: pearson(rotated, KK_MINOR) });
  }
  candidates.sort((a, b) => b.r - a.r);

  const best = candidates[0];
  const PITCH_CLASSES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const alternatives = candidates.slice(1, 5).map(c => ({
    label: PITCH_CLASSES[c.root] + " " + c.scale,
    correlation: Math.round(Math.max(0, c.r) * 1000) / 1000,
  }));

  onProgress(1, "Done");
  return {
    label: PITCH_CLASSES[best.root] + " " + best.scale,
    tonic: PITCH_CLASSES[best.root],
    scale: best.scale,
    correlation: Math.round(Math.max(0, best.r) * 1000) / 1000,
    alternatives,
  };
}
`;

let sharedWorker: Worker | null = null;

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!sharedWorker) {
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      sharedWorker = new Worker(url);
    } catch {
      sharedWorker = null;
    }
  }
  return sharedWorker;
}

export function runDspInWorker<T>(
  type: "bpm" | "key",
  payload: { mono: Float32Array; sampleRate: number; analyzedSeconds?: number; useFull?: boolean },
  opts: { onProgress?: (p: number, stage: string) => void; signal?: AbortSignal }
): Promise<T> {
  const worker = getWorker();
  if (!worker) {
    return Promise.reject(new Error("Worker unavailable"));
  }

  const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      worker.removeEventListener("message", onMessage);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (opts.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const onMessage = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      if (e.data.type === "progress") {
        opts.onProgress?.(e.data.progress, e.data.stage);
      } else if (e.data.type === "result") {
        opts.signal?.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        resolve(e.data.result as T);
      } else if (e.data.type === "error") {
        opts.signal?.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        reject(new Error(e.data.message));
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, type, ...payload }, [payload.mono.buffer]);
  });
}
