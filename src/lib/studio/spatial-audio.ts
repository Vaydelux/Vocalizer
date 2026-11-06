"use client";

/**
 * Enterprise 3D Binaural Spatial Audio & Surround Sound Engine
 *
 * Implements spherical-to-Cartesian 3D coordinate mapping, Web Audio HRTF
 * (Head-Related Transfer Function) spatial auditioning, Woodworth's Interaural
 * Time Difference (ITD) acoustic modeling, and 5.1 Surround matrix pan compilation.
 */

import { z } from "zod";

/* ------------------------------- Zod Schemas ------------------------------- */

export const spatialPositionSchema = z.object({
  /** Azimuth angle in degrees: -180 (back) to 0 (front) to +180 (back). -90 is Left, +90 is Right. */
  azimuthDeg: z.number().min(-180).max(180).default(0),
  /** Elevation angle in degrees: -90 (nadir/below) to 0 (ear level) to +90 (zenith/overhead). */
  elevationDeg: z.number().min(-90).max(90).default(0),
  /** Distance in meters from listener center (0, 0, 0): 0.2m to 20m. Default 1.0m. */
  distanceMeters: z.number().min(0.2).max(20.0).default(1.0),
  /** Room acoustic reflection amount (0 to 1). */
  roomReflection: z.number().min(0).max(1).default(0.15),
});

export type SpatialPosition = z.infer<typeof spatialPositionSchema>;

export const DEFAULT_SPATIAL_POSITION: SpatialPosition = {
  azimuthDeg: 0,
  elevationDeg: 0,
  distanceMeters: 1.0,
  roomReflection: 0.15,
};

export interface Cartesian3D {
  x: number; // Right (+X) / Left (-X)
  y: number; // Up (+Y) / Down (-Y)
  z: number; // Behind (+Z) / In Front (-Z)
}

export interface Surround51Gains {
  fl: number;  // Front Left
  fr: number;  // Front Right
  fc: number;  // Front Center
  lfe: number; // Subwoofer / Low Frequency Effects
  sl: number;  // Surround Left
  sr: number;  // Surround Right
}

/* --------------------------- Coordinate Transforms ------------------------- */

/**
 * Converts Spherical Coordinates (Azimuth, Elevation, Distance) into Web Audio
 * Cartesian 3D coordinates where:
 * - Listener is at (0, 0, 0)
 * - Facing forward along -Z
 * - +X is to the right
 * - +Y is upwards
 */
export function sphericalToCartesian(pos: SpatialPosition): Cartesian3D {
  const radAz = (pos.azimuthDeg * Math.PI) / 180;
  const radEl = (pos.elevationDeg * Math.PI) / 180;
  const d = Math.max(0.1, pos.distanceMeters);

  const cosEl = Math.cos(radEl);
  const x = d * cosEl * Math.sin(radAz);
  const y = d * Math.sin(radEl);
  const z = -d * cosEl * Math.cos(radAz);

  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    z: Number(z.toFixed(4)),
  };
}

/**
 * Calculates Woodworth's Interaural Time Difference (ITD) in milliseconds.
 * Model: Spherical head of average human radius r = 0.0875m, speed of sound c = 343 m/s.
 * Formula: ITD = (r / c) * (sin|theta| + |theta|)
 * Yields ~0ms at center and max ~0.66ms at 90 degrees azimuth.
 */
export function calculateWoodworthItdMs(azimuthDeg: number): number {
  const HEAD_RADIUS_M = 0.0875;
  const SPEED_OF_SOUND_MPS = 343.0;

  // Normalize azimuth to 0..90 degrees offset from median plane
  const absAz = Math.abs(azimuthDeg);
  const thetaRad = (Math.min(90, absAz > 90 ? 180 - absAz : absAz) * Math.PI) / 180;

  const itdSec = (HEAD_RADIUS_M / SPEED_OF_SOUND_MPS) * (Math.sin(thetaRad) + thetaRad);
  return Number((itdSec * 1000).toFixed(3)); // Milliseconds
}

/* ------------------------ 5.1 Surround Panning Matrix ---------------------- */

/**
 * Computes energy-preserving discrete 5.1 surround speaker channel gains
 * from azimuth angle (-180° to +180°) and distance attenuation.
 * Channel layout:
 * - FL: -30°
 * - FR: +30°
 * - FC: 0°
 * - SL: -110°
 * - SR: +110°
 * - LFE: 0.15 constant sub-bass feed
 */
export function computeSurround51Gains(pos: SpatialPosition): Surround51Gains {
  const az = pos.azimuthDeg;
  const distAtten = 1 / Math.max(0.5, pos.distanceMeters);

  // Normalize angles to 0..360 for radial distance
  const normAz = az < 0 ? az + 360 : az;

  // Speaker nominal azimuths in degrees (0 = Center Front)
  const speakers = [
    { id: "fc", angle: 0 },
    { id: "fr", angle: 30 },
    { id: "sr", angle: 110 },
    { id: "sl", angle: 250 },
    { id: "fl", angle: 330 },
  ];

  const rawGains: Record<string, number> = { fl: 0, fr: 0, fc: 0, lfe: 0.15, sl: 0, sr: 0 };

  // Calculate inverse angular distance weight for each speaker
  let totalWeight = 0;
  const weights: Record<string, number> = {};

  for (const spk of speakers) {
    let diff = Math.abs(normAz - spk.angle);
    if (diff > 180) diff = 360 - diff;
    // Cosine proximity roll-off (active within ±90 degrees)
    const w = diff < 90 ? Math.pow(Math.cos((diff * Math.PI) / 180), 2) : 0;
    weights[spk.id] = w;
    totalWeight += w;
  }

  // Energy normalization: sum(gain^2) = 1.0 (constant acoustic power)
  const normFactor = totalWeight > 0 ? 1 / Math.sqrt(Object.values(weights).reduce((a, b) => a + b * b, 0) || 1) : 1;

  for (const spk of speakers) {
    rawGains[spk.id] = Number((weights[spk.id] * normFactor * distAtten).toFixed(3));
  }

  return {
    fl: rawGains.fl,
    fr: rawGains.fr,
    fc: rawGains.fc,
    lfe: Number((0.15 * distAtten).toFixed(3)),
    sl: rawGains.sl,
    sr: rawGains.sr,
  };
}

/* -------------------------- Web Audio HRTF Graph --------------------------- */

/**
 * Creates and configures a native Web Audio PannerNode with binaural HRTF modeling.
 */
export function createSpatialPannerNode(audioCtx: AudioContext, pos: SpatialPosition): PannerNode {
  const panner = audioCtx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1.0;
  panner.maxDistance = 20.0;
  panner.rolloffFactor = 1.0;
  panner.coneInnerAngle = 360;

  updateSpatialPannerNode(panner, pos);
  return panner;
}

/**
 * Updates the 3D position of an existing Web Audio PannerNode in real time.
 */
export function updateSpatialPannerNode(panner: PannerNode, pos: SpatialPosition): void {
  const { x, y, z } = sphericalToCartesian(pos);
  if (panner.positionX && panner.positionX.setValueAtTime) {
    panner.positionX.setValueAtTime(x, panner.context.currentTime);
    panner.positionY.setValueAtTime(y, panner.context.currentTime);
    panner.positionZ.setValueAtTime(z, panner.context.currentTime);
  } else {
    // Older browser fallback
    panner.setPosition(x, y, z);
  }
}

/* ----------------------- Pure FFmpeg Spatial Filter ------------------------ */

/**
 * Compiles 3D spatial parameters into high-precision FFmpeg audio filter clauses.
 * Supports:
 * - "binaural": Interaural time delay (adelay) and acoustic head-shadow diffraction.
 * - "surround51": 6-channel discrete matrix routing (pan=5.1).
 */
export function buildSpatialAudioFilter(
  pos: SpatialPosition,
  mode: "binaural" | "surround51" = "binaural"
): string[] {
  const filters: string[] = [];

  if (mode === "surround51") {
    const g = computeSurround51Gains(pos);
    // pan=5.1|c0=FL|c1=FR|c2=FC|c3=LFE|c4=SL|c5=SR
    filters.push(
      `pan=5.1|c0=${g.fl}*c0|c1=${g.fr}*c0|c2=${g.fc}*c0|c3=${g.lfe}*c0|c4=${g.sl}*c0|c5=${g.sr}*c0`
    );
    return filters;
  }

  // Mode: Binaural 3D (Headphones)
  const itdMs = calculateWoodworthItdMs(pos.azimuthDeg);
  const az = pos.azimuthDeg;
  const dist = Math.max(0.2, pos.distanceMeters);
  const distGain = Number((1 / Math.sqrt(dist)).toFixed(3));

  // If source is panned to the right (az > 0), Left ear is delayed and low-pass shadowed
  // If source is panned to the left (az < 0), Right ear is delayed and low-pass shadowed
  if (Math.abs(az) < 3) {
    // Center dead-ahead
    if (distGain !== 1.0) {
      filters.push(`volume=${distGain}`);
    }
  } else if (az > 0) {
    // Source on the RIGHT: Right ear receives direct sound, Left ear delayed by itdMs
    const delaySamples = Math.round(itdMs * 48); // 48 samples per ms at 48kHz
    filters.push(`adelay=0|${delaySamples}`);
    // Head shadow: shelf-filter left ear at 3.5 kHz by -4dB
    filters.push("equalizer=f=3500:t=q:w=1.0:g=-4.0");
  } else {
    // Source on the LEFT: Left ear receives direct sound, Right ear delayed by itdMs
    const delaySamples = Math.round(itdMs * 48);
    filters.push(`adelay=${delaySamples}|0`);
    filters.push("equalizer=f=3500:t=q:w=1.0:g=-4.0");
  }

  return filters;
}
