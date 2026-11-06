import { describe, expect, it } from "bun:test";
import { BatchJobRegistry } from "../../src/lib/studio/batch-cancellation";

describe("batch cancellation registry", () => {
  it("cancels each active or queued job, but never an unrelated job", () => {
    const cancelled: string[] = [];
    const run = new BatchJobRegistry((id) => cancelled.push(id));
    run.track("batch-A"); run.track("batch-B");
    run.finish("batch-A");
    run.cancel();
    expect(cancelled).toEqual(["batch-B"]);
    expect(run.signal.aborted).toBe(true);
    run.cancel();
    expect(cancelled).toEqual(["batch-B"]);
  });

  it("immediately cancels a job registered after root abort", () => {
    const cancelled: string[] = [];
    const run = new BatchJobRegistry((id) => cancelled.push(id));
    run.cancel();
    run.track("late-job");
    expect(cancelled).toEqual(["late-job"]);
    run.finish("late-job");
    expect(run.activeCount).toBe(0);
  });

  it("does not abort another concurrent job group", () => {
    const cancelled: string[] = [];
    const a = new BatchJobRegistry((id) => cancelled.push(id));
    const b = new BatchJobRegistry((id) => cancelled.push(id));
    a.track("batch-job"); b.track("unrelated-job");
    a.cancel();
    expect(cancelled).toEqual(["batch-job"]);
    expect(b.signal.aborted).toBe(false);
  });
});
