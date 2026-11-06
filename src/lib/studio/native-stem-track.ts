/** Native stem tracks are disk-backed and never copied into renderer Blobs. */
import type { AudioMeta, AudioTrack } from "./types";
import type { NativeAudioMeta } from "./ipc-contracts";
import { isNative } from "./native";

export function audioMetaFromNativeProbe(source: NativeAudioMeta): AudioMeta {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 ||
      !Number.isFinite(source.duration) || source.duration <= 0 ||
      source.duration > 24 * 60 * 60 ||
      !source.sampleRate || !Number.isFinite(source.sampleRate) || source.sampleRate <= 0 ||
      !source.channels || !Number.isInteger(source.channels) || source.channels < 1) {
    throw new Error("Native stem probe returned invalid audio metadata.");
  }
  return {
    duration: source.duration,
    sampleRate: source.sampleRate,
    channels: source.channels,
    lengthSamples: null, // ffprobe stream duration isn't a decoded sample count.
    effectiveBitrateKbps: Math.round(source.sizeBytes * 8 / source.duration / 1000),
    probeNote: "Verified disk-backed stem, measured by the native FFprobe worker.",
    metaSource: "native-probe",
  };
}

export function hasUsableTrackAudio(track: AudioTrack): boolean {
  return track.status === "ready" && (
    track.file.size > 0 || (Boolean(track.nativeStem) && isNative())
  );
}

/** Preserve the actual published output basename for project v2 relinking.
 * Split both Windows and POSIX separators; never infer the file name from the
 * original song because published files are named Vocalizer-job-<stem>. */
export function stemFilenameFromPublishedPath(publishedPath: string): string {
  const name = publishedPath.split(/[\\/]/).pop();
  if (!name || name === "." || name === ".." ||
      !/\.(wav|flac|mp3)$/i.test(name) || /[\x00-\x1f]/.test(name)) {
    throw new Error("Completed stem has no supported published filename.");
  }
  return name;
}
