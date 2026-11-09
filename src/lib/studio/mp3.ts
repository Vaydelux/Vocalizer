/**
 * MP3 encoder via @breezystack/lamejs — the browser-side "equivalent compatible
 * backend" for MP3 export where FFmpeg isn't available. Chunked, cancellable,
 * with real progress. No fabricated output.
 */

import { Mp3Encoder } from "@breezystack/lamejs";
import { studioError } from "./errors";

export interface EncodeMp3Options {
  bitrateKbps: number; // 96..320
  signal: AbortSignal;
  onProgress?: (p: number) => void;
}

/** Clamp and quantize PCM before writing into a signed 16-bit array. */
function toPcm16(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  const s = Math.max(-1, Math.min(1, sample));
  return Math.trunc(s < 0 ? s * 0x8000 : s * 0x7fff);
}

/**
 * Convert input channels to mono/stereo samples without ever accumulating
 * intermediate sums inside an Int16Array (which wraps on overflow).
 * For 3+ channels, the secondary channels are averaged for the right output
 * to avoid accidental clipping; this is not a surround-layout-aware mix.
 */
export function downmixMp3Channels(
  channelData: readonly Float32Array[],
  signal?: AbortSignal,
): { left: Int16Array; right: Int16Array | null } {
  const length = channelData[0]?.length ?? 0;
  if (channelData.length === 0 || length === 0) {
    throw studioError("OUTPUT_EMPTY", "Cannot encode MP3 audio without samples.");
  }
  if (channelData.some((channel) => channel.length !== length)) {
    throw studioError("INPUT_INVALID", "MP3 channel arrays must have equal sample lengths.");
  }
  const left = new Int16Array(length);
  const secondaryCount = channelData.length - 1;
  const right = secondaryCount > 0 ? new Int16Array(length) : null;
  for (let i = 0; i < length; i++) {
    if ((i & 8191) === 0 && signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    left[i] = toPcm16(channelData[0][i]);
    if (right) {
      let sum = 0;
      for (let c = 1; c < channelData.length; c++) {
        const sample = channelData[c][i];
        sum += Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      }
      right[i] = toPcm16(sum / secondaryCount);
    }
  }
  return { left, right };
}

/**
 * Encode an AudioBuffer to an MP3 Blob. Multi-channel (>2) buffers are
 * downmixed to stereo first (left = ch0, right = average of others).
 */
export async function encodeMp3(buffer: AudioBuffer, opts: EncodeMp3Options): Promise<Blob> {
  const { bitrateKbps, signal, onProgress } = opts;
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  if (!Number.isInteger(channels) || channels < 1 ||
      !Number.isInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isInteger(bitrateKbps) || bitrateKbps < 96 || bitrateKbps > 320) {
    throw studioError("INPUT_INVALID", "Invalid MP3 channel count, sample rate or bitrate.");
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const channelData = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  const { left, right } = downmixMp3Channels(channelData, signal);

  const enc = new Mp3Encoder(right ? 2 : 1, sampleRate, bitrateKbps);
  const chunkSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += chunkSize) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const end = Math.min(i + chunkSize, left.length);
    const l = left.subarray(i, end);
    const r = right ? right.subarray(i, end) : null;
    const buf = r ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    if (buf.length > 0) chunks.push(buf);
    onProgress?.(end / left.length);
    // Yield periodically to keep the UI responsive on long encodes.
    if ((i / chunkSize) % 64 === 0) await new Promise<void>((r2) => setTimeout(r2, 0));
  }

  const tail = enc.flush();
  if (tail.length > 0) chunks.push(tail);

  // Concatenate into one Blob.
  const total = chunks.reduce((s, c) => s + c.length, 0);
  if (total === 0) {
    throw studioError("OUTPUT_EMPTY", "MP3 encoder produced 0 bytes of audio data.");
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new Blob([merged], { type: "audio/mpeg" });
}
