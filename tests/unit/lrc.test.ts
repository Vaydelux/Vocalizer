import { describe, it, expect } from "bun:test";
import { parseLrc, activeLrcIndex } from "../../src/lib/studio/lrc";

describe("LRC parser and synchronization", () => {
  it("parses valid LRC lines with timestamps", () => {
    const lrc = `
[ti:Sample Track]
[00:05.50]First line of vocals
[00:10.00]Second line of vocals
[00:15.25]Third line of vocals
    `;
    const result = parseLrc(lrc);
    expect(result.lines.length).toBe(3);
    expect(result.lines[0].time).toBeCloseTo(5.5, 2);
    expect(result.lines[0].text).toBe("First line of vocals");
    expect(result.lines[1].time).toBeCloseTo(10.0, 2);
    expect(result.lines[2].time).toBeCloseTo(15.25, 2);
  });

  it("handles offset tag correctly", () => {
    const lrc = `
[offset:+500]
[00:02.00]Line after offset
    `;
    const result = parseLrc(lrc);
    expect(result.offsetSec).toBeCloseTo(0.5, 2);
  });

  it("finds active line index accurately based on current playback time", () => {
    const lines = [
      { time: 2.0, text: "Line 1" },
      { time: 5.0, text: "Line 2" },
      { time: 8.0, text: "Line 3" },
    ];

    expect(activeLrcIndex(lines, 1.0)).toBe(-1); // Before first line
    expect(activeLrcIndex(lines, 2.5)).toBe(0);  // During line 1
    expect(activeLrcIndex(lines, 5.0)).toBe(1);  // Exactly at line 2
    expect(activeLrcIndex(lines, 7.9)).toBe(1);  // Just before line 3
    expect(activeLrcIndex(lines, 10.0)).toBe(2); // After last line
  });
});
