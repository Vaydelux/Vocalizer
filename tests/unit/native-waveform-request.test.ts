import { describe, expect, it } from "bun:test";
import { inferenceWaveformRequestSchema } from "../../electron/shared/ipc";
import {
  sameWaveformRequest,
  type WaveformRequestIdentity,
} from "../../electron/shared/waveform-request";

const first: WaveformRequestIdentity = {
  jobId: "finished-001",
  stem: "Vocals",
  requestId: "3f8d97b5-eae8-4fa2-aa5f-0b483fc09821",
};
const reopened: WaveformRequestIdentity = {
  ...first,
  requestId: "df4b1dba-38c6-4e65-840d-f28db9a9251a",
};

describe("native waveform per-invocation cancellation", () => {
  it("cancels only the exact task that owns the request ID", () => {
    expect(sameWaveformRequest(first, first)).toBe(true);
    expect(sameWaveformRequest(first, { ...first })).toBe(true);
    expect(sameWaveformRequest(reopened, first)).toBe(false);
    expect(sameWaveformRequest(first, reopened)).toBe(false);
    expect(sameWaveformRequest(null, first)).toBe(false);
  });

  it("does not treat a different stem or job as the same task", () => {
    expect(sameWaveformRequest(first, { ...first, stem: "Instrumental" })).toBe(false);
    expect(sameWaveformRequest(first, { ...first, jobId: "other-job" })).toBe(false);
  });

  it("simulates stale cleanup after reopening the same stem", () => {
    let active: WaveformRequestIdentity | null = first;
    active = reopened;
    const oldCleanupWouldCancelNewRequest = sameWaveformRequest(active, first);
    expect(oldCleanupWouldCancelNewRequest).toBe(false);
    expect(sameWaveformRequest(active, reopened)).toBe(true);
  });

  it("rejects legacy cancellation without request identity or malformed UUIDs", () => {
    expect(inferenceWaveformRequestSchema.safeParse({
      jobId: first.jobId, stem: first.stem,
    }).success).toBe(false);
    expect(inferenceWaveformRequestSchema.safeParse({
      ...first, requestId: "same-job-not-unique",
    }).success).toBe(false);
    expect(inferenceWaveformRequestSchema.safeParse(first).success).toBe(true);
    expect(inferenceWaveformRequestSchema.safeParse(reopened).success).toBe(true);
    expect(inferenceWaveformRequestSchema.safeParse({
      ...first, stem: "../outside",
    }).success).toBe(false);
  });
});
