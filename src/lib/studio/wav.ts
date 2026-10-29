/**
 * WAV (RIFF) encoder — real PCM encoding, 16/24-bit.
 * Chunked with progress reporting and abort support. No fabricated output.
 */

import { studioError } from "./errors";

export type WavBitDepth = 16 | 24;

export interface EncodeWavOptions {
  bitDepth: WavBitDepth;
  signal: AbortSignal;
  onProgress?: (p: number) => void;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Encode an AudioBuffer to a WAV Blob.
 * Interleaves channels, clamps samples, supports 16/24-bit PCM.
 */
export async function encodeWav(buffer: AudioBuffer, opts: EncodeWavOptions): Promise<Blob> {
  const { bitDepth, signal, onProgress } = opts;
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Pull channel data once (avoid per-sample channel lookup cost).
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  const CHUNK_FRAMES = 65536;
  let offset = headerSize;
  for (let start = 0; start < numFrames; start += CHUNK_FRAMES) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const end = Math.min(start + CHUNK_FRAMES, numFrames);
    for (let i = start; i < end; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = channels[c][i];
        if (!Number.isFinite(s)) s = 0;
        s = Math.max(-1, Math.min(1, s));
        if (bitDepth === 16) {
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          offset += 2;
        } else {
          const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    onProgress?.(end / numFrames);
    // Yield to keep UI responsive on long encodes.
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  if (dataSize === 0) {
    throw studioError("OUTPUT_EMPTY", "WAV encoder produced 0 bytes of audio data.");
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/** Encode raw float32 mono data at a sample rate (used by DSP outputs). */
export async function encodeWavFromChannels(
  channels: Float32Array[],
  sampleRate: number,
  opts: EncodeWavOptions
): Promise<Blob> {
  const length = channels[0]?.length ?? 0;
  const numChannels = channels.length;
  const bytesPerSample = opts.bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const totalSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, opts.bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const CHUNK = 65536;
  let offset = 44;
  for (let start = 0; start < length; start += CHUNK) {
    if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const end = Math.min(start + CHUNK, length);
    for (let i = start; i < end; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = channels[c][i];
        if (!Number.isFinite(s)) s = 0;
        s = Math.max(-1, Math.min(1, s));
        if (opts.bitDepth === 16) {
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          offset += 2;
        } else {
          const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    opts.onProgress?.(end / length);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}
