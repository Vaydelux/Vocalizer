/**
 * LRC (synchronized lyrics) parser — practical subset of the format.
 * Supports: multiple [mm:ss.xx] timestamps per line, [offset:+/-ms] global tag,
 * metadata tags ([ar:],[ti:],...) are ignored, blank text lines kept as gaps.
 * Anything unparseable is reported as an issue — never silently dropped.
 */

export interface LrcLine {
  time: number; // seconds
  text: string;
}

export interface LrcParseResult {
  lines: LrcLine[];
  offsetSec: number;
  issues: string[];
}

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(raw: string): LrcParseResult {
  const issues: string[] = [];
  const lines: LrcLine[] = [];
  let offsetSec = 0;

  const textLines = raw.split(/\r?\n/);
  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i].trim();
    if (line.length === 0) continue;

    // Global offset tag
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (offsetMatch) {
      offsetSec = parseInt(offsetMatch[1], 10) / 1000;
      continue;
    }

    // Pure metadata tags like [ar: Artist] — recognized, ignored.
    if (/^\[(ar|ti|al|au|by|length|re|ve|tool):.*\]$/i.test(line)) {
      continue;
    }

    TIME_TAG.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let lastTagEnd = -1;
    while ((match = TIME_TAG.exec(line)) !== null) {
      const mm = parseInt(match[1], 10);
      const ss = parseInt(match[2], 10);
      const fracRaw = match[3] ?? "0";
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      const t = mm * 60 + ss + frac;
      if (mm > 59 || ss > 59) {
        issues.push(`Line ${i + 1}: suspicious timestamp [${match[0]}] (kept as-is).`);
      }
      times.push(t);
      lastTagEnd = TIME_TAG.lastIndex;
    }

    if (times.length === 0) {
      if (/^\[[a-z]+:/i.test(line)) {
        issues.push(`Line ${i + 1}: unknown tag ignored — "${line.slice(0, 40)}".`);
      } else {
        issues.push(`Line ${i + 1}: no timestamp found — skipped ("${line.slice(0, 40)}").`);
      }
      continue;
    }

    const text = line.slice(lastTagEnd).trim();
    for (const t of times) {
      lines.push({ time: t, text });
    }
  }

  if (lines.length === 0) {
    issues.push("No timestamped lyric lines found. This does not look like an LRC file.");
  }

  lines.sort((a, b) => a.time - b.time);
  return { lines, offsetSec, issues };
}

/** Find the active lyric index at time `t` (seconds, already offset-applied). */
export function activeLrcIndex(lines: LrcLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
