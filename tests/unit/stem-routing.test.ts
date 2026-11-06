import { describe, expect, it } from "bun:test";
import type { Job } from "../../src/lib/studio/types";
import {
  finishStemRoute,
  hasRoutedStemJob,
  reserveStemRoute,
  shouldAutoRouteStemJob,
} from "../../src/lib/studio/stem-routing";

const completed = (id: string, trackId = "track-1") => ({
  id,
  state: "completed" as const,
  result: {
    name: "stems.json", url: "blob:fixture", size: 1, mime: "application/json",
    sourceTrackId: trackId,
    stemFiles: [{ stem: "Vocals" as const, path: "fixture.wav" }],
  },
});

describe("DAW stem routing ledger", () => {
  it("prevents concurrent or repeated routing of a completed job", () => {
    const id = "stem-job-1";
    expect(reserveStemRoute(id)).toBe(true);
    expect(reserveStemRoute(id)).toBe(false);
    finishStemRoute(id, true);
    expect(hasRoutedStemJob(id)).toBe(true);
    expect(reserveStemRoute(id)).toBe(false);
  });

  it("allows retry of a job that imported no stems", () => {
    const id = "stem-job-retry";
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, false);
    expect(hasRoutedStemJob(id)).toBe(false);
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, true);
  });

  it("routes only the latest completed job on the selected source", () => {
    const job = completed("stem-job-auto");
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(true);
    expect(shouldAutoRouteStemJob(false, job.id, "track-1", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, "old-job", "track-1", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "another-track", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", { ...job, state: "running" })).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", { ...job, result: null })).toBe(false);
    expect(reserveStemRoute(job.id)).toBe(true);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(false);
    finishStemRoute(job.id, true);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(false);
  });
});
