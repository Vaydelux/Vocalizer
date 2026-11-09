/**
 * Shared, deterministic audio-join timeline for renderer and desktop.
 *
 * Each adjacent pair may overlap for at most half of either clip. This
 * guarantees a middle clip's fade-in and fade-out never intersect, including
 * when a requested crossfade is longer than one of the inputs.
 */
export interface JoinTimeline {
  startFrames: number[];
  overlapFrames: number[];
  totalFrames: number;
}

export function planJoinTimeline(
  lengths: readonly number[],
  requestedOverlapFrames: number,
): JoinTimeline {
  if (lengths.length === 0 || lengths.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
      !Number.isSafeInteger(requestedOverlapFrames) || requestedOverlapFrames < 0) {
    throw new Error("Join timeline requires positive integer lengths and a nonnegative overlap.");
  }
  const overlapFrames: number[] = [];
  for (let i = 0; i < lengths.length - 1; i++) {
    overlapFrames.push(Math.min(
      requestedOverlapFrames,
      Math.floor(lengths[i] / 2),
      Math.floor(lengths[i + 1] / 2),
    ));
  }
  const startFrames = [0];
  for (let i = 1; i < lengths.length; i++) {
    const start = startFrames[i - 1] + lengths[i - 1] - overlapFrames[i - 1];
    if (!Number.isSafeInteger(start)) throw new Error("Joined timeline exceeds integer precision.");
    startFrames.push(start);
  }
  const totalFrames = startFrames[startFrames.length - 1] + lengths[lengths.length - 1];
  if (!Number.isSafeInteger(totalFrames)) throw new Error("Joined timeline exceeds integer precision.");
  return { startFrames, overlapFrames, totalFrames };
}
