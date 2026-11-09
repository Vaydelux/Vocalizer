import { describe, expect, it } from "bun:test";
import { inferenceSeparateRequestSchema } from "../../electron/shared/ipc";
import { inferenceSeparateSchema, serializeWorkerRequest } from "../../electron/shared/inference-protocol";

const ipcRequest = {
  jobId: "rate-regression",
  modelId: "local-mdx",
  modelPath: "C:/models/local.onnx",
  architecture: "mdx-net",
  inputPath: "C:/music/sample.wav",
  outputDir: "C:/music/stems",
  requestedStems: ["Vocals", "Instrumental"],
  outputFormat: "mp3",
  device: "cpu",
};
const workerRequest = {
  ...ipcRequest,
  requestId: ipcRequest.jobId,
  type: "separate",
};

describe("AI stem MP3 bitrate protocol", () => {
  for (const bitrate of [128, 192, 256, 320]) {
    it(`preserves ${bitrate} kbps through IPC and worker serialization`, () => {
      const main = inferenceSeparateRequestSchema.parse({
        ...ipcRequest, mp3Bitrate: bitrate,
      });
      const worker = inferenceSeparateSchema.parse({
        ...workerRequest, mp3Bitrate: main.mp3Bitrate,
      });
      const serialized = JSON.parse(serializeWorkerRequest(worker));
      expect(main.mp3Bitrate).toBe(bitrate);
      expect(worker.mp3Bitrate).toBe(bitrate);
      expect(serialized.mp3Bitrate).toBe(bitrate);
    });
  }

  it("accepts older clients that omit the optional rate", () => {
    const main = inferenceSeparateRequestSchema.parse(ipcRequest);
    const worker = inferenceSeparateSchema.parse(workerRequest);
    expect(main.mp3Bitrate).toBeUndefined();
    expect(worker.mp3Bitrate).toBeUndefined();
  });

  it("rejects unsupported rate values in both boundaries", () => {
    for (const bad of [0, 96, 160, 999, Number.NaN, Infinity, "320k", null]) {
      expect(inferenceSeparateRequestSchema.safeParse({
        ...ipcRequest, mp3Bitrate: bad,
      }).success).toBe(false);
      expect(inferenceSeparateSchema.safeParse({
        ...workerRequest, mp3Bitrate: bad,
      }).success).toBe(false);
    }
  });
});
