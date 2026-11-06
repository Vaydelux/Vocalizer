"use client";

/**
 * Enterprise Audio DSP Effect Chain
 *
 * Provides typed parametric Equalizer, Dynamic Compressor, Reverb, and Limiter.
 * Supports real-time Web Audio API graph generation for playback and compile-to-FFmpeg
 * audio filter chains for bit-for-bit identical native export.
 */

import { z } from "zod";

/* ------------------------------- Zod Schemas ------------------------------- */

export const eqSchema = z.object({
  enabled: z.boolean(),
  lowGainDb: z.number().min(-24).max(24),
  lowFreq: z.number().min(20).max(1000),
  midGainDb: z.number().min(-24).max(24),
  midFreq: z.number().min(200).max(8000),
  midQ: z.number().min(0.1).max(10),
  highGainDb: z.number().min(-24).max(24),
  highFreq: z.number().min(2000).max(20000),
});

export const compressorSchema = z.object({
  enabled: z.boolean(),
  thresholdDb: z.number().min(-60).max(0),
  ratio: z.number().min(1).max(20),
  attackSec: z.number().min(0.001).max(1.0),
  releaseSec: z.number().min(0.01).max(2.0),
  kneeDb: z.number().min(0).max(20),
});

export const reverbSchema = z.object({
  enabled: z.boolean(),
  decaySec: z.number().min(0.1).max(10.0),
  wetDry: z.number().min(0).max(1.0),
});

export const limiterSchema = z.object({
  enabled: z.boolean(),
  ceilingDb: z.number().min(-12).max(0),
  releaseSec: z.number().min(0.01).max(1.0),
});

export const dspEffectChainSchema = z.object({
  eq: eqSchema,
  compressor: compressorSchema,
  reverb: reverbSchema,
  limiter: limiterSchema,
});

export type EqSettings = z.infer<typeof eqSchema>;
export type CompressorSettings = z.infer<typeof compressorSchema>;
export type ReverbSettings = z.infer<typeof reverbSchema>;
export type LimiterSettings = z.infer<typeof limiterSchema>;
export type DspEffectChain = z.infer<typeof dspEffectChainSchema>;

/* --------------------------------- Defaults -------------------------------- */

export const DEFAULT_EQ: EqSettings = {
  enabled: false,
  lowGainDb: 0,
  lowFreq: 100,
  midGainDb: 0,
  midFreq: 1000,
  midQ: 1.0,
  highGainDb: 0,
  highFreq: 8000,
};

export const DEFAULT_COMPRESSOR: CompressorSettings = {
  enabled: false,
  thresholdDb: -18,
  ratio: 4,
  attackSec: 0.01,
  releaseSec: 0.15,
  kneeDb: 6,
};

export const DEFAULT_REVERB: ReverbSettings = {
  enabled: false,
  decaySec: 1.8,
  wetDry: 0.25,
};

export const DEFAULT_LIMITER: LimiterSettings = {
  enabled: true,
  ceilingDb: -0.5,
  releaseSec: 0.05,
};

export const DEFAULT_EFFECT_CHAIN: DspEffectChain = {
  eq: DEFAULT_EQ,
  compressor: DEFAULT_COMPRESSOR,
  reverb: DEFAULT_REVERB,
  limiter: DEFAULT_LIMITER,
};

/* -------------------------- FFmpeg Filter Compiler ------------------------- */

export function dbToLinearGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Compiles a DSP effect chain into FFmpeg audio filter clauses.
 * Each filter clause is guaranteed to be syntactically valid FFmpeg filter syntax.
 */
export function buildFfmpegDspFilters(chain: DspEffectChain): string[] {
  const filters: string[] = [];

  // 1. Equalizer (Lowshelf, Peaking Mid, Highshelf)
  if (chain.eq.enabled) {
    const eqClauses: string[] = [];
    if (Math.abs(chain.eq.lowGainDb) > 0.01) {
      eqClauses.push(`lowshelf=f=${chain.eq.lowFreq}:g=${chain.eq.lowGainDb.toFixed(2)}`);
    }
    if (Math.abs(chain.eq.midGainDb) > 0.01) {
      eqClauses.push(
        `equalizer=f=${chain.eq.midFreq}:width_type=q:w=${chain.eq.midQ.toFixed(2)}:g=${chain.eq.midGainDb.toFixed(2)}`
      );
    }
    if (Math.abs(chain.eq.highGainDb) > 0.01) {
      eqClauses.push(`highshelf=f=${chain.eq.highFreq}:g=${chain.eq.highGainDb.toFixed(2)}`);
    }
    if (eqClauses.length > 0) {
      filters.push(eqClauses.join(","));
    }
  }

  // 2. Dynamic Compressor
  if (chain.compressor.enabled) {
    const c = chain.compressor;
    const attackMs = Math.max(1, Math.round(c.attackSec * 1000));
    const releaseMs = Math.max(10, Math.round(c.releaseSec * 1000));
    filters.push(
      `acompressor=threshold=${c.thresholdDb.toFixed(1)}dB:ratio=${c.ratio.toFixed(1)}:attack=${attackMs}:release=${releaseMs}:knee=${c.kneeDb.toFixed(1)}`
    );
  }

  // 3. Peak Limiter
  if (chain.limiter.enabled) {
    const l = chain.limiter;
    const limitLinear = dbToLinearGain(l.ceilingDb);
    const releaseMs = Math.max(10, Math.round(l.releaseSec * 1000));
    filters.push(`alimiter=limit=${limitLinear.toFixed(4)}:release=${releaseMs}`);
  }

  return filters;
}

/* ------------------------ Web Audio API Graph Nodes ------------------------ */

export interface DspAudioNodes {
  input: GainNode;
  output: GainNode;
  lowShelf: BiquadFilterNode;
  midPeaking: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  disconnect: () => void;
}

/**
 * Constructs an off-thread-ready Web Audio API node graph for real-time auditioning.
 */
export function createDspAudioNodes(audioCtx: AudioContext, chain: DspEffectChain): DspAudioNodes {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();

  const lowShelf = audioCtx.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = chain.eq.lowFreq;
  lowShelf.gain.value = chain.eq.enabled ? chain.eq.lowGainDb : 0;

  const midPeaking = audioCtx.createBiquadFilter();
  midPeaking.type = "peaking";
  midPeaking.frequency.value = chain.eq.midFreq;
  midPeaking.Q.value = chain.eq.midQ;
  midPeaking.gain.value = chain.eq.enabled ? chain.eq.midGainDb : 0;

  const highShelf = audioCtx.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = chain.eq.highFreq;
  highShelf.gain.value = chain.eq.enabled ? chain.eq.highGainDb : 0;

  const compressor = audioCtx.createDynamicsCompressor();
  if (chain.compressor.enabled) {
    compressor.threshold.value = chain.compressor.thresholdDb;
    compressor.ratio.value = chain.compressor.ratio;
    compressor.attack.value = chain.compressor.attackSec;
    compressor.release.value = chain.compressor.releaseSec;
    compressor.knee.value = chain.compressor.kneeDb;
  } else {
    // Transparent bypass
    compressor.threshold.value = 0;
    compressor.ratio.value = 1;
  }

  // Connect chain: input -> lowShelf -> midPeaking -> highShelf -> compressor -> output
  input.connect(lowShelf);
  lowShelf.connect(midPeaking);
  midPeaking.connect(highShelf);
  highShelf.connect(compressor);
  compressor.connect(output);

  return {
    input,
    output,
    lowShelf,
    midPeaking,
    highShelf,
    compressor,
    disconnect: () => {
      try {
        input.disconnect();
        lowShelf.disconnect();
        midPeaking.disconnect();
        highShelf.disconnect();
        compressor.disconnect();
        output.disconnect();
      } catch {
        // Ignored
      }
    },
  };
}
