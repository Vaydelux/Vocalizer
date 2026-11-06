import { describe, it, expect } from "bun:test";
import { isLaneAudible, type TrackLane } from "../../src/lib/studio/store-mixer";
import { DEFAULT_EFFECT_CHAIN } from "../../src/lib/studio/dsp-effects";

describe("multi-track mixer solo/mute routing matrix", () => {
  const createMockLane = (id: string, muted = false, solo = false): TrackLane => ({
    id,
    trackId: `track-${id}`,
    name: `Track ${id}`,
    color: "violet",
    offsetSec: 0,
    gainDb: 0,
    pan: 0,
    muted,
    solo,
    effects: DEFAULT_EFFECT_CHAIN,
  });

  it("plays all unmuted tracks when no solo is active", () => {
    const lane1 = createMockLane("1", false, false);
    const lane2 = createMockLane("2", false, false);
    const lane3 = createMockLane("3", true, false); // muted

    const all = [lane1, lane2, lane3];

    expect(isLaneAudible(lane1, all)).toBe(true);
    expect(isLaneAudible(lane2, all)).toBe(true);
    expect(isLaneAudible(lane3, all)).toBe(false);
  });

  it("mutes non-solo tracks when any track is soloed", () => {
    const lane1 = createMockLane("1", false, false);
    const lane2 = createMockLane("2", false, true); // solo!
    const lane3 = createMockLane("3", false, false);

    const all = [lane1, lane2, lane3];

    expect(isLaneAudible(lane1, all)).toBe(false);
    expect(isLaneAudible(lane2, all)).toBe(true);
    expect(isLaneAudible(lane3, all)).toBe(false);
  });

  it("mutes a solo track if it is also explicitly muted", () => {
    const lane1 = createMockLane("1", true, true); // solo AND mute
    const lane2 = createMockLane("2", false, false);

    const all = [lane1, lane2];

    expect(isLaneAudible(lane1, all)).toBe(false);
    expect(isLaneAudible(lane2, all)).toBe(false);
  });
});
