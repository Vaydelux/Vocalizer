/**
 * Single source of truth for the audio preview's volume/mute controls.
 *
 * Keep user-visible state, the HTMLAudioElement and saved volume consistent.
 * A zero-volume slider move retains the most recent audible volume so the
 * mute button can restore it without unexpectedly jumping to full volume.
 */
export interface PlayerVolumeState {
  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
}

export function clampPlayerVolume(requested: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(1, requested));
}

export function createPlayerVolumeState(initialVolume: number): PlayerVolumeState {
  const volume = clampPlayerVolume(initialVolume);
  return { volume, muted: volume === 0, lastAudibleVolume: volume || 0.5 };
}

export function changePlayerVolume(state: PlayerVolumeState, requested: number): PlayerVolumeState {
  const volume = clampPlayerVolume(requested);
  return {
    volume,
    muted: volume === 0,
    lastAudibleVolume: volume > 0 ? volume : state.lastAudibleVolume,
  };
}

export function togglePlayerMute(state: PlayerVolumeState): PlayerVolumeState {
  if (!state.muted) return { ...state, muted: true };
  if (state.volume > 0) return { ...state, muted: false };
  // Muting at 0 is indistinguishable from silence: unmute restores a
  // previously chosen level rather than leaving a "playing but silent" UI.
  const volume = clampPlayerVolume(state.lastAudibleVolume) || 0.5;
  return { volume, muted: false, lastAudibleVolume: volume };
}

export function applyPlayerVolume(
  media: Pick<HTMLMediaElement, "volume" | "muted">,
  state: PlayerVolumeState,
): void {
  media.volume = state.volume;
  media.muted = state.muted;
}
