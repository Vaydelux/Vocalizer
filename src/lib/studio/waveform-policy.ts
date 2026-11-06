/**
 * Full decoded waveforms are optional. For large audio or uncertain metadata,
 * use the streaming media element rather than materializing an entire PCM copy.
 */
import { mayDecodeBrowserAudio } from "./decode-budget";

export interface WaveformSource {
  file: { size: number };
  meta?: { duration: number } | null;
  nativeStem?: unknown;
}

export function mayComputeFullWaveform(source: WaveformSource): boolean {
  return !source.nativeStem &&
    mayDecodeBrowserAudio(source.file.size, source.meta?.duration ?? null);
}

export function shouldPreloadMetadataOnly(source: WaveformSource): boolean {
  return !mayComputeFullWaveform(source);
}
