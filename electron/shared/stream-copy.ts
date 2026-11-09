/**
 * Authoritative audio-only container selection for FFmpeg stream-copy.
 *
 * Derive the output muxer from FFprobe's actual codec AND container, never
 * from a filename or renderer-supplied extension. An unsupported pairing must
 * be re-encoded rather than copied into a misleading file.
 *
 * This module is pure/isomorphic: Electron main and the renderer use the same
 * whitelist, but main repeats the probe and enforces the result at execution.
 */
export interface StreamCopyProbe {
  codec: string | null;
  format: string | null;
}

export interface StreamCopyContainer {
  extension: string;
  mime: string;
  label: string;
}

export const STREAM_COPY_EXTENSIONS = [
  "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "webm", "aiff", "wma",
] as const;

/** Only known FFmpeg-muxable codec/container pairs may be stream-copied. */
export function resolveStreamCopyContainer(
  meta: StreamCopyProbe,
): StreamCopyContainer | null {
  if (typeof meta.codec !== "string" || typeof meta.format !== "string") return null;
  const codec = meta.codec.toLowerCase().trim();
  const formats = new Set(meta.format.toLowerCase().split(",").map((s) => s.trim()));
  const has = (name: string) => formats.has(name);

  if (has("mp3") && codec === "mp3") {
    return { extension: "mp3", mime: "audio/mpeg", label: "MP3" };
  }
  if (has("wav") && codec.startsWith("pcm_")) {
    return { extension: "wav", mime: "audio/wav", label: "PCM WAV" };
  }
  if (has("flac") && codec === "flac") {
    return { extension: "flac", mime: "audio/flac", label: "FLAC" };
  }
  if ((has("mov") || has("mp4") || has("m4a")) &&
      (codec === "aac" || codec === "alac")) {
    return { extension: "m4a", mime: "audio/mp4", label: "M4A" };
  }
  if (has("aac") && codec === "aac") {
    return { extension: "aac", mime: "audio/aac", label: "AAC" };
  }
  if (has("ogg") && codec === "vorbis") {
    return { extension: "ogg", mime: "audio/ogg", label: "Ogg Vorbis" };
  }
  if (has("ogg") && codec === "opus") {
    return { extension: "opus", mime: "audio/ogg", label: "Ogg Opus" };
  }
  if (has("webm") && (codec === "opus" || codec === "vorbis")) {
    return { extension: "webm", mime: "audio/webm", label: "WebM audio" };
  }
  if (has("aiff") && codec.startsWith("pcm_")) {
    return { extension: "aiff", mime: "audio/aiff", label: "AIFF" };
  }
  if (has("asf") && (codec === "wmav1" || codec === "wmav2")) {
    return { extension: "wma", mime: "audio/x-ms-wma", label: "Windows Media Audio" };
  }
  return null;
}
