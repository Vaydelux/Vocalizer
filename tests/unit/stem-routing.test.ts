import { describe, expect, it } from "bun:test";
import {
  finishStemRoute, hasRoutedStemJob, markAutoStemAttempt,
  pendingStemNames, reserveStemRoute, shouldAutoRouteStemJob,
} from "../../src/lib/studio/stem-routing";
import type { ModelStem } from "../../src/lib/studio/types";

const stems: ModelStem[] = ["Vocals", "Drums", "Bass", "Other"];
const completed = (id: string, trackId = "track-1") => ({
  id, state: "completed" as const,
  result: {
    name: "stems.json", url: "blob:fixture", size: 1, mime: "application/json",
    sourceTrackId: trackId,
    stemFiles: stems.map((stem) => ({stem, path: "fixture.wav"})),
  },
});

describe("per-stem mixer routing", () => {
  it("prevents concurrent imports and duplicate lanes", () => {
    const id = "routing-test-full";
    expect(reserveStemRoute(id)).toBe(true);
    expect(reserveStemRoute(id)).toBe(false);
    finishStemRoute(id, stems);
    expect(hasRoutedStemJob(id, stems)).toBe(true);
    expect(pendingStemNames(id, stems)).toEqual([]);
  });

  it("allows retry only for stems that failed", () => {
    const id = "routing-test-partial";
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, ["Vocals", "Other"]);
    expect(hasRoutedStemJob(id, stems)).toBe(false);
    expect(pendingStemNames(id, stems)).toEqual(["Drums", "Bass"]);
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, ["Drums", "Bass"]);
    expect(hasRoutedStemJob(id, stems)).toBe(true);
    expect(pendingStemNames(id, stems)).toEqual([]);
  });

  it("retries when no stems were imported", () => {
    const id = "routing-test-empty";
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, []);
    expect(pendingStemNames(id, stems)).toEqual(stems);
    expect(reserveStemRoute(id)).toBe(true);
    finishStemRoute(id, ["Vocals"]);
  });

  it("limits automatic attempts to once per job; manual retry stays available", () => {
    const job = completed("routing-test-auto");
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(true);
    expect(markAutoStemAttempt(job.id)).toBe(true);
    expect(markAutoStemAttempt(job.id)).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(false);
    expect(reserveStemRoute(job.id)).toBe(true);
    finishStemRoute(job.id, ["Vocals"]);
    expect(pendingStemNames(job.id, stems)).toEqual(["Drums", "Bass", "Other"]);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", job)).toBe(false);
  });

  it("rejects mismatched jobs, tracks and incomplete operations", () => {
    const job = completed("routing-test-mismatch");
    expect(shouldAutoRouteStemJob(false, job.id, "track-1", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, "old-job", "track-1", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "different", job)).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", {...job, state:"running"})).toBe(false);
    expect(shouldAutoRouteStemJob(true, job.id, "track-1", {...job, result:null})).toBe(false);
  });
});
