/**
 * RFC 9110 single-byte-range planning for local streamed media.
 * This module deliberately does not accept multipart requests: browsers can
 * request the next range after a bounded, correctly framed 206 response.
 */
export type MediaByteRange =
  | { status: 200 | 206; start: number; end: number; length: number; contentRange?: string }
  | { status: 416; length: 0; contentRange: string };

export function planMediaByteRange(raw: string | null, size: number): MediaByteRange {
  // File sizes passed here must come from an opened and checked file handle.
  if (!Number.isSafeInteger(size) || size < 1) {
    return { status: 416, length: 0, contentRange: `bytes */${Math.max(0, Number.isSafeInteger(size) ? size : 0)}` };
  }
  if (raw === null) return { status: 200, start: 0, end: size - 1, length: size };
  // Reject comma-separated multipart ranges and loose number conversions.
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!match || (!match[1] && !match[2])) {
    return { status: 416, length: 0, contentRange: `bytes */${size}` };
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) {
      return { status: 416, length: 0, contentRange: `bytes */${size}` };
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= size || end < start) {
      return { status: 416, length: 0, contentRange: `bytes */${size}` };
    }
    end = Math.min(end, size - 1);
  }
  return {
    status: 206,
    start,
    end,
    length: end - start + 1,
    contentRange: `bytes ${start}-${end}/${size}`,
  };
}
