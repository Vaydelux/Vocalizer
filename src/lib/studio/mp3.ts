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

/** Convert a Float32 channel to 16-bit PCM Int16Array (clamped, dithered by rounding). */
function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(-1, Math.min(1, s));
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return out;
}

/**
 * Encode an AudioBuffer to an MP3 Blob. Multi-channel (>2) buffers are
 * downmixed to stereo first (left/right = ch0 / sum of remaining).
 */
export async function encodeMp3(buffer: AudioBuffer, opts: EncodeMp3Options): Promise<Blob> {
  const { bitrateKbps, signal, onProgress } = opts;
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  const left = floatToInt16(buffer.getChannelData(0));
  let right: Int16Array | null = null;
  if (channels > 1) {
    // Downmix channels 1..n-1 into a single right channel.
    const len = buffer.length;
    right = new Int16Array(len);
    for (let c = 1; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        let s = data[i];
        if (!Number.isFinite(s)) s = 0;
        s = Math.max(-1, Math.min(1, s));
        right[i] = (right[i] + (s < 0 ? s * 0x8000 : s * 0x7fff)) | 0;
      }
    }
  }

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
