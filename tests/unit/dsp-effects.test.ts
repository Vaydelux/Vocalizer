import { describe, it, expect } from "bun:test";
import {
  buildFfmpegDspFilters,
  DEFAULT_EFFECT_CHAIN,
  dbToLinearGain,
  dspEffectChainSchema,
  type DspEffectChain,
} from "../../src/lib/studio/dsp-effects";

describe("audio DSP effect chain", () => {
  it("computes linear gain from decibels correctly", () => {
    expect(dbToLinearGain(0)).toBeCloseTo(1.0, 5);
    expect(dbToLinearGain(6)).toBeCloseTo(1.99526, 3);
    expect(dbToLinearGain(-6)).toBeCloseTo(0.50118, 3);
    expect(dbToLinearGain(-20)).toBeCloseTo(0.1, 5);
  });

  it("validates default effect chain against zod schema", () => {
    const parseResult = dspEffectChainSchema.safeParse(DEFAULT_EFFECT_CHAIN);
    expect(parseResult.success).toBe(true);
  });

  it("generates correct FFmpeg filters when EQ, compressor, and limiter are enabled", () => {
    const chain: DspEffectChain = {
      eq: {
        enabled: true,
        lowGainDb: 3.5,
        lowFreq: 120,
        midGainDb: -2.0,
        midFreq: 1500,
        midQ: 1.2,
        highGainDb: 4.0,
        highFreq: 10000,
      },
      compressor: {
        enabled: true,
        thresholdDb: -24,
        ratio: 4.5,
        attackSec: 0.02,
        releaseSec: 0.25,
        kneeDb: 6,
      },
      reverb: {
        enabled: false,
        decaySec: 2.0,
        wetDry: 0.3,
      },
      limiter: {
        enabled: true,
        ceilingDb: -1.0,
        releaseSec: 0.05,
      },
    };

    const filters = buildFfmpegDspFilters(chain);
    expect(filters.length).toBe(3);

    // 1. EQ
    expect(filters[0]).toContain("lowshelf=f=120:g=3.50");
    expect(filters[0]).toContain("equalizer=f=1500:width_type=q:w=1.20:g=-2.00");
    expect(filters[0]).toContain("highshelf=f=10000:g=4.00");

    // 2. Compressor
    expect(filters[1]).toContain("acompressor=threshold=-24.0dB:ratio=4.5:attack=20:release=250:knee=6.0");

    // 3. Limiter
    expect(filters[2]).toContain("alimiter=limit=");
  });

  it("produces only limiter when other modules are bypassed", () => {
    const filters = buildFfmpegDspFilters(DEFAULT_EFFECT_CHAIN);
    expect(filters.length).toBe(1);
    expect(filters[0]).toContain("alimiter=limit=");
  });
});
