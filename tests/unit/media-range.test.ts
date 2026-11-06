import { describe, expect, it } from "bun:test";
import { planMediaByteRange } from "../../electron/shared/media-range";

const gib = 1024 ** 3;

describe("native audio single-byte-range planning", () => {
  it("serves full media without an explicit Range header", () => {
    expect(planMediaByteRange(null, 200)).toEqual({
      status: 200, start: 0, end: 199, length: 200,
    });
  });
  it("handles open-ended, suffix, and explicit byte ranges", () => {
    expect(planMediaByteRange("bytes=10-19", 100)).toEqual({
      status: 206, start: 10, end: 19, length: 10, contentRange: "bytes 10-19/100",
    });
    expect(planMediaByteRange("bytes=90-", 100)).toEqual({
      status: 206, start: 90, end: 99, length: 10, contentRange: "bytes 90-99/100",
    });
    expect(planMediaByteRange("bytes=-10", 100)).toEqual({
      status: 206, start: 90, end: 99, length: 10, contentRange: "bytes 90-99/100",
    });
    expect(planMediaByteRange("bytes=-999", 100)).toEqual({
      status: 206, start: 0, end: 99, length: 100, contentRange: "bytes 0-99/100",
    });
    expect(planMediaByteRange("bytes=70-999", 100)).toEqual({
      status: 206, start: 70, end: 99, length: 30, contentRange: "bytes 70-99/100",
    });
  });
  it("supports byte offsets greater than 4 GiB without 32-bit overflow", () => {
    expect(planMediaByteRange(`bytes=${4*gib+5}-${4*gib+15}`, 5*gib)).toEqual({
      status: 206, start: 4*gib+5, end: 4*gib+15, length: 11,
      contentRange: `bytes ${4*gib+5}-${4*gib+15}/${5*gib}`,
    });
  });
  it("returns correct 416 for malformed, multipart, overflow and unsatisfiable requests", () => {
    for (const range of [
      "bytes=100-", "bytes=21-20", "bytes=-0", "bytes=-",
      "bytes=0-1,3-4", "bytes=abc-def", "items=0-1",
      "bytes=9007199254740993-",
    ]) {
      expect(planMediaByteRange(range, 100)).toEqual({
        status: 416, length: 0, contentRange: "bytes */100",
      });
    }
    expect(planMediaByteRange("bytes=0-", 0).status).toBe(416);
  });
});
