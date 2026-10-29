/**
 * Unified audio encoder dispatcher. Picks the real backend per format:
 *  - wav16 / wav24: PCM via the WAV encoder
 *  - mp3: @breezystack/lamejs (the browser-side "equivalent compatible backend")
 * FLAC is intentionally NOT claimed here — no verified browser backend is
 * wired, so it stays an honest desktop-build capability.
 */

import type { ExportFormat, Mp3Bitrate } from "./types";
import { encodeWav, type WavBitDepth } from "./wav";
import { encodeMp3 } from "./mp3";

export interface EncodeOptions {
  format: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
  signal: AbortSignal;
  onProgress?: (p: number) => void;
}

export interface EncodeResult {
  blob: Blob;
  mime: string;
  ext: string;
}

export async function encodeAudio(buffer: AudioBuffer, opts: EncodeOptions): Promise<EncodeResult> {
  const { format, signal, onProgress } = opts;
  if (format === "mp3") {
    const bitrate = opts.mp3Bitrate ?? 192;
    const blob = await encodeMp3(buffer, { bitrateKbps: bitrate, signal, onProgress });
    return { blob, mime: "audio/mpeg", ext: "mp3" };
  }
  const bitDepth: WavBitDepth = format === "wav24" ? 24 : 16;
  const blob = await encodeWav(buffer, { bitDepth, signal, onProgress });
  return { blob, mime: "audio/wav", ext: "wav" };
}
