/**
 * Decoder allocation policy for the waveform UI. A 1 GiB PCM stem can easily
 * expand to multiple GiB in decodeAudioData; large and disk-backed tracks
 * must use the media element for playback without computing in-memory peaks.
 */
import { MAX_DECODE_BYTES } from "./decode";

export interface WaveformSource {
  file: { size: number };
  nativeStem?: unknown;
}

export function mayComputeFullWaveform(source: WaveformSource): boolean {
  return !source.nativeStem && source.file.size > 0 &&
    source.file.size <= MAX_DECODE_BYTES;
}

export function shouldPreloadMetadataOnly(source: WaveformSource): boolean {
  return !mayComputeFullWaveform(source);
}
