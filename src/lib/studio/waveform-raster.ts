/**
 * Shared raster planning for both static waveform and animated overlay.
 * Keep independent canvas bitmaps aligned without scaling to the full song.
 */
import { MAX_WAVEFORM_RASTER_PX } from "./waveform-viewport";

export interface WaveformRaster {
  width: number;
  height: number;
  scale: number;
}

export function planWaveformRaster(
  widthCss: number,
  heightCss: number,
  devicePixelRatio: number,
): WaveformRaster {
  const width = Number.isFinite(widthCss) ? Math.max(1, Math.ceil(widthCss)) : 1;
  const height = Number.isFinite(heightCss) ? Math.max(1, Math.ceil(heightCss)) : 1;
  const dpr = Number.isFinite(devicePixelRatio)
    ? Math.max(0.1, Math.min(devicePixelRatio, 2)) : 1;
  // Also bound the vertical raster for unusually tall view configurations.
  // The cap must hold even at extreme zoom/device sizes; a nonzero
  // minimum scale would accidentally allow an oversized bitmap.
  const scale = Math.min(dpr, MAX_WAVEFORM_RASTER_PX / width, 4096 / height);
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
    scale,
  };
}
