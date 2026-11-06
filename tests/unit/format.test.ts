import { describe, it, expect } from "bun:test";
import {
  formatTime,
  formatTimeMs,
  formatBytes,
  formatPercent,
  sanitizeFileName,
  baseName,
  timestampSlug,
} from "../../src/lib/studio/format";

describe("format utilities", () => {
  it("formats seconds to MM:SS.d correctly", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(65)).toBe("1:05.0");
    expect(formatTime(3600)).toBe("60:00.0");
  });

  it("formats milliseconds accurately", () => {
    expect(formatTimeMs(1.234)).toBe("0:01.234");
    expect(formatTimeMs(0)).toBe("0:00.000");
  });

  it("formats byte sizes with correct units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
  });

  it("formats percentages cleanly", () => {
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.999)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("sanitizes filenames preventing path traversal", () => {
    expect(sanitizeFileName("my/song\\track:1?.wav")).toBe("my_song_track_1_.wav");
    expect(sanitizeFileName("..\\../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFileName("")).toBe("audio");
  });

  it("extracts baseName without extensions", () => {
    expect(baseName("vocal_track.mp3")).toBe("vocal_track");
    expect(baseName("complex.name.wav")).toBe("complex.name");
    expect(baseName("noextension")).toBe("noextension");
  });

  it("generates date-based timestamp slug", () => {
    const slug = timestampSlug();
    expect(slug).toMatch(/^\d{8}-\d{6}$/);
  });
});
