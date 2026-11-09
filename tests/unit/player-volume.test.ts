import { describe, expect, it } from "bun:test";
import {
  applyPlayerVolume,
  changePlayerVolume,
  clampPlayerVolume,
  createPlayerVolumeState,
  togglePlayerMute,
} from "../../src/lib/studio/player-volume";

function fakeMedia() {
  return { volume: 0, muted: false };
}

describe("WavePlayer audio volume state", () => {
  it("unmutes the actual media element when volume is raised after muting", () => {
    const media = fakeMedia();
    const first = createPlayerVolumeState(0.6);
    applyPlayerVolume(media, first);
    expect(media.volume).toBe(0.6);
    expect(media.muted).toBe(false);

    const muted = togglePlayerMute(first);
    applyPlayerVolume(media, muted);
    expect(media.muted).toBe(true);
    expect(media.volume).toBe(0.6);

    const raised = changePlayerVolume(muted, 0.8);
    applyPlayerVolume(media, raised);
    expect(raised.muted).toBe(false);
    expect(media.volume).toBe(0.8);
    expect(media.muted).toBe(false);
  });

  it("restores the previous audible level after the slider reaches zero", () => {
    const media = fakeMedia();
    const state = createPlayerVolumeState(0.35);
    const silent = changePlayerVolume(state, 0);
    applyPlayerVolume(media, silent);
    expect(silent.volume).toBe(0);
    expect(silent.lastAudibleVolume).toBe(0.35);
    expect(media.muted).toBe(true);

    const restored = togglePlayerMute(silent);
    applyPlayerVolume(media, restored);
    expect(restored.volume).toBe(0.35);
    expect(restored.muted).toBe(false);
    expect(media.volume).toBe(0.35);
    expect(media.muted).toBe(false);
  });

  it("preserves slider level through two consecutive mute toggles", () => {
    const state = createPlayerVolumeState(0.75);
    const afterMute = togglePlayerMute(state);
    const afterUnmute = togglePlayerMute(afterMute);
    expect(afterMute.volume).toBe(0.75);
    expect(afterMute.muted).toBe(true);
    expect(afterUnmute.volume).toBe(0.75);
    expect(afterUnmute.muted).toBe(false);
  });

  it("starts from a safe audible level when saved volume is zero", () => {
    const initial = createPlayerVolumeState(0);
    expect(initial.muted).toBe(true);
    const restored = togglePlayerMute(initial);
    expect(restored.volume).toBe(0.5);
    expect(restored.muted).toBe(false);
  });

  it("clamps invalid saved and slider volume values", () => {
    expect(clampPlayerVolume(-3)).toBe(0);
    expect(clampPlayerVolume(4)).toBe(1);
    expect(clampPlayerVolume(Number.NaN)).toBe(0);
    expect(createPlayerVolumeState(Number.POSITIVE_INFINITY).volume).toBe(0);
    const state = createPlayerVolumeState(0.4);
    expect(changePlayerVolume(state, -99).volume).toBe(0);
    expect(changePlayerVolume(state, 99).volume).toBe(1);
  });
});
