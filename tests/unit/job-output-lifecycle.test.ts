import { describe, expect, it, spyOn } from "bun:test";
import { hasValidJobOutput, releaseBrowserJobOutput } from "../../src/lib/studio/job-output";
import type { JobResultFile } from "../../src/lib/studio/types";

const output = (url: string, size = 12, nativePath = false): JobResultFile => ({
  name: "output.wav",
  size,
  mime: "audio/wav",
  url,
  nativePath,
});

describe("job output lifecycle", () => {
  it("accepts only a real positive, safe integer byte size", () => {
    expect(hasValidJobOutput(output("blob:good", 12))).toBe(true);
    for (const size of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(hasValidJobOutput(output("blob:bad", size))).toBe(false);
    }
    expect(hasValidJobOutput(null)).toBe(false);
    expect(hasValidJobOutput(undefined)).toBe(false);
  });

  it("releases browser URLs on discard, not native or unrelated URLs", () => {
    const revoked: string[] = [];
    const revoke = (url: string) => { revoked.push(url); };
    expect(releaseBrowserJobOutput(output("blob:discard"), revoke)).toBe(true);
    expect(releaseBrowserJobOutput(output("file:///music.wav", 42, true), revoke)).toBe(false);
    expect(releaseBrowserJobOutput(output("blob:native", 42, true), revoke)).toBe(false);
    expect(releaseBrowserJobOutput(output("https://example.test/music.wav"), revoke)).toBe(false);
    expect(releaseBrowserJobOutput(null, revoke)).toBe(false);
    expect(revoked).toEqual(["blob:discard"]);
  });

  it("ignores object URL revocation failures without disrupting job state", () => {
    expect(releaseBrowserJobOutput(output("blob:already-gone"), () => {
      throw new Error("URL already revoked");
    })).toBe(false);
  });

  it("releases a late-created Blob when cancellation wins the encoding race", async () => {
    const { useJobs } = await import("../../src/lib/studio/store-jobs");
    const revoked: string[] = [];
    const revokeSpy = spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
    try {
      let finish!: (result: JobResultFile) => void;
      const pending = new Promise<JobResultFile>((resolve) => { finish = resolve; });
      const id = useJobs.getState().enqueue("export", "race-check", async () => pending);
      expect(useJobs.getState().jobs.find((job) => job.id === id)?.state).toBe("running");

      useJobs.getState().cancel(id);
      expect(useJobs.getState().jobs.find((job) => job.id === id)?.state).toBe("cancelling");
      finish(output("blob:race-check", 32768));

      for (let i = 0; i < 20; i++) {
        if (useJobs.getState().jobs.find((job) => job.id === id)?.state === "cancelled") break;
        await Promise.resolve();
      }
      const job = useJobs.getState().jobs.find((j) => j.id === id);
      expect(job?.state).toBe("cancelled");
      expect(job?.result).toBeNull();
      expect(revoked).toEqual(["blob:race-check"]);
      useJobs.getState().clearFinished();
    } finally {
      revokeSpy.mockRestore();
    }
  });
});
