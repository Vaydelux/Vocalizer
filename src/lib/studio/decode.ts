/**
 * Audio decoding + metadata extraction (real, no invention).
 *
 * Validation policy: file type is verified by actually decoding with the
 * platform decoder — not by trusting the filename extension (matches the
 * spec's "validate using supported decoders, not extensions").
 *
 * Size policy: decodeAudioData materializes the full PCM in memory. Files above
 * MAX_DECODE_BYTES fall back to <audio> metadata (duration only) and the UI
 * labels the reduced probe instead of pretending to know sample rate/channels.
 */

import { studioError } from "./errors";
import type { AudioMeta } from "./types";

export const MAX_DECODE_BYTES = 150 * 1024 * 1024; // 150 MB safety cap for full PCM decode

let sharedCtx: AudioContext | null = null;

/** Lazily created shared AudioContext for decoding (sampleRate 44100 default; decode resamples). */
export function getDecodeContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

export async function closeDecodeContext(): Promise<void> {
  if (sharedCtx && sharedCtx.state !== "closed") {
    await sharedCtx.close();
    sharedCtx = null;
  }
}

export interface DecodeResult {
  buffer: AudioBuffer;
  meta: AudioMeta;
}

/** Decode a file into an AudioBuffer with authoritative metadata. Throws typed errors. */
export async function decodeFile(file: File, signal?: AbortSignal): Promise<DecodeResult> {
  if (file.size === 0) {
    throw studioError("CORRUPT_FILE", `${file.name}: 0 bytes`, "File is empty.");
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    throw studioError("MISSING_FILE", `${file.name} could not be read`, String(err));
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const ctx = getDecodeContext();
  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    return {
      buffer,
      meta: {
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        lengthSamples: buffer.length,
        effectiveBitrateKbps:
          buffer.duration > 0 ? Math.round((file.size * 8) / buffer.duration / 1000) : null,
        probeNote: "Decoded via Web Audio decodeAudioData (authoritative).",
        metaSource: "decoded",
      },
    };
  } catch (err) {
    throw studioError(
      "UNSUPPORTED_MEDIA",
      `${file.name}: decoder rejected the stream`,
      String(err)
    );
  }
}

/**
 * Metadata probe without keeping the decoded buffer: decodes, extracts meta,
 * then releases. Falls back to HTMLAudioElement for very large files.
 */
export async function probeMetadata(file: File): Promise<AudioMeta> {
  if (file.size <= MAX_DECODE_BYTES) {
    const { buffer, meta } = await decodeFile(file);
    void buffer; // decoded buffer is released when this scope exits
    return meta;
  }
  const meta = await probeViaElement(file);
  return meta;
}

/** Duration-only probe using an <audio> element. Honest about what it can't know. */
export function probeViaElement(file: File): Promise<AudioMeta> {
  return new Promise<AudioMeta>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    const cleanup = () => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(studioError("DECODE_FAILED", `${file.name}: metadata probe timed out`));
    }, 20000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      cleanup();
      if (duration <= 0) {
        reject(studioError("UNSUPPORTED_MEDIA", `${file.name}: no readable audio duration`));
        return;
      }
      resolve({
        duration,
        sampleRate: null,
        channels: null,
        lengthSamples: null,
        effectiveBitrateKbps: Math.round((file.size * 8) / duration / 1000),
        probeNote:
          "Duration measured via media element (file too large for full decode). Sample rate and channel count not probed — reported as unknown rather than guessed.",
        metaSource: "element",
      });
    };
    el.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(studioError("UNSUPPORTED_MEDIA", `${file.name}: media element could not read it`));
    };
    el.src = url;
  });
}

/* ---------------------------- capability probing --------------------------- */

export interface PlaybackSupport {
  ext: string;
  label: string;
  mimeCandidates: string[];
  support: "probably" | "maybe" | "no";
}

const PROBE_FORMATS: { ext: string; label: string; mimeCandidates: string[] }[] = [
  { ext: "mp3", label: "MP3", mimeCandidates: ["audio/mpeg"] },
  { ext: "wav", label: "WAV", mimeCandidates: ["audio/wav", "audio/x-wav"] },
  { ext: "flac", label: "FLAC", mimeCandidates: ["audio/flac", "audio/x-flac"] },
  { ext: "m4a", label: "M4A / AAC", mimeCandidates: ["audio/mp4", "audio/aac"] },
  { ext: "ogg", label: "OGG", mimeCandidates: ["audio/ogg", "application/ogg"] },
  { ext: "opus", label: "Opus", mimeCandidates: ["audio/ogg; codecs=opus"] },
  { ext: "webm", label: "WebM Audio", mimeCandidates: ["audio/webm"] },
  { ext: "aac", label: "AAC (raw)", mimeCandidates: ["audio/aac"] },
];

/** Real browser canPlayType probes — reported verbatim, no invention. */
export function probePlaybackSupport(): PlaybackSupport[] {
  const el = document.createElement("audio");
  return PROBE_FORMATS.map((f) => {
    let support: PlaybackSupport["support"] = "no";
    for (const mime of f.mimeCandidates) {
      const r = el.canPlayType(mime);
      if (r === "probably") {
        support = "probably";
        break;
      }
      if (r === "maybe") support = "maybe";
    }
    return { ...f, support };
  });
}

export interface RecorderMimeSupport {
  mime: string;
  supported: boolean;
}

const RECORDER_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/** Real MediaRecorder.isTypeSupported results. */
export function probeRecorderMimes(): RecorderMimeSupport[] {
  if (typeof MediaRecorder === "undefined") {
    return RECORDER_CANDIDATES.map((mime) => ({ mime, supported: false }));
  }
  return RECORDER_CANDIDATES.map((mime) => ({
    mime,
    supported: MediaRecorder.isTypeSupported(mime),
  }));
}

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of RECORDER_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}
