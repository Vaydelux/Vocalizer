/** Typed opaque references for verified stem outputs.
 * No renderer-chosen filesystem path is accepted through these references. */
export type NativeStemName =
  | "Vocals" | "Instrumental" | "Drums" | "Bass" | "Guitar" | "Piano" | "Other";

export interface NativeStemRef {
  jobId: string;
  stem: NativeStemName;
}

const JOB = /^[a-zA-Z0-9_-]{1,80}$/;
const STEMS = new Set<NativeStemName>([
  "Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other",
]);
export const STEM_INPUT_PREFIX = "vocalizer-stem:";

export function nativeStemInput(ref: NativeStemRef): string {
  if (!JOB.test(ref.jobId) || !STEMS.has(ref.stem)) {
    throw new Error("Invalid verified stem reference.");
  }
  return `${STEM_INPUT_PREFIX}${ref.jobId}:${ref.stem}`;
}

/** A malformed reserved-prefix token is rejected, never treated as a path. */
export function parseNativeStemInput(value: string): NativeStemRef | null {
  if (!value.startsWith(STEM_INPUT_PREFIX)) return null;
  const rest = value.slice(STEM_INPUT_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  const jobId = rest.slice(0, sep);
  const stem = rest.slice(sep + 1) as NativeStemName;
  if (sep < 0 || !JOB.test(jobId) || !STEMS.has(stem)) {
    throw new Error("Invalid verified stem reference.");
  }
  return { jobId, stem };
}

export function nativeStemPlaybackUrl(ref: NativeStemRef): string {
  nativeStemInput(ref);
  return `las://renderer/__stem-audio/${encodeURIComponent(ref.jobId)}/${ref.stem}`;
}
