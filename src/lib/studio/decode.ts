/**
 * Audio decoding + metadata extraction (real, no invention).
 *
 * Validation policy: file type is verified by actually decoding with the
 * platform decoder — not by trusting the filename extension (matches the
 * spec's "validate using supported decoders, not extensions").
 *
 * Memory policy: preflight media duration before decodeAudioData. Files that
 * exceed the compressed input or projected PCM budget retain measured metadata
 * without materializing the entire recording in browser memory.
 */

import { studioError } from "./errors";
import type { AudioMeta } from "./types";
import { MAX_DECODE_BYTES, mayDecodeBrowserAudio } from "./decode-budget";
export { MAX_DECODE_BYTES } from "./decode-budget";

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

/** Decode only after a measured media duration passes the memory guardrail. */
export async function decodeFile(file: File, signal?: AbortSignal): Promise<DecodeResult> {
  if (file.size === 0) {
    throw studioError("CORRUPT_FILE", `${file.name}: 0 bytes`, "File is empty.");
  }
  if (file.size > MAX_DECODE_BYTES) {
    throw studioError("FILE_TOO_LARGE", "File exceeds the safe browser decode size. Use native FFmpeg processing.");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const preflight = await probeViaElement(file);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!mayDecodeBrowserAudio(file.size, preflight.duration)) {
    throw studioError("FILE_TOO_LARGE", "Measured audio duration would exceed the browser PCM memory budget. Use the native desktop engine.");
  }
  return decodeAfterPreflight(file, signal);
}

/** Private: callers must have already completed duration and size preflight. */
async function decodeAfterPreflight(file: File, signal?: AbortSignal): Promise<DecodeResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    throw studioError("MISSING_FILE", `${file.name} could not be read`, String(err));
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const ctx = getDecodeContext();
  try {
    // decodeAudioData may detach its ArrayBuffer. This is the only owner of
    // the input bytes, so avoid allocating another full compressed copy.
    const buffer = await ctx.decodeAudioData(bytes);
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
 * Metadata always starts with a lightweight media-element duration probe.
 * A small *compressed* input may still contain hours of decoded PCM, so
 * only suitable sources proceed to the full browser decoder.
 */
export async function probeMetadata(file: File): Promise<AudioMeta> {
  if (file.size === 0) {
    throw studioError("CORRUPT_FILE", `${file.name}: 0 bytes`, "File is empty.");
  }
  const preflight = await probeViaElement(file);
  if (!mayDecodeBrowserAudio(file.size, preflight.duration)) {
    return preflight;
  }
  const { meta } = await decodeAfterPreflight(file);
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
          "Duration measured via media element without full PCM allocation. Sample rate and channel count not probed — reported as unknown rather than guessed.",
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
