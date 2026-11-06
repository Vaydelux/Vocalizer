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
