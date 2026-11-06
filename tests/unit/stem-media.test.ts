import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { streamVerifiedStem } from "../../electron/main/services/stem-media";

let dir: string;
let fixture: string;
const bytes = Buffer.from("abcdefghijklmnopqrstuvwxyz");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vocalizer-range-"));
  fixture = path.join(dir, "Vocalizer-seek-demo-vocals.wav");
  await fs.writeFile(fixture, bytes);
});
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function request(range?: string, method = "GET"): Request {
  return new Request("https://renderer.local/__stem-audio/test/Vocals", {
    method,
    headers: range ? { Range: range } : {},
  });
}

describe("native file-backed audio streaming", () => {
  it("streams a full response without an in-memory Blob intermediary", async () => {
    const response = await streamVerifiedStem(request(), fixture);
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("honors accurate 206 seeks with only the requested bytes", async () => {
    const response = await streamVerifiedStem(request("bytes=10-15"), fixture);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 10-15/26");
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(await response.text()).toBe("klmnop");
  });

  it("responds with an empty 416 and total size for an unsatisfiable range", async () => {
    const response = await streamVerifiedStem(request("bytes=999-"), fixture);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */26");
    expect(response.headers.get("Content-Length")).toBe("0");
    expect(await response.text()).toBe("");
  });

  it("supports HEAD without sending audio and refuses unsupported methods", async () => {
    const head = await streamVerifiedStem(request("bytes=5-9", "HEAD"), fixture);
    expect(head.status).toBe(206);
    expect(head.body).toBeNull();
    expect(head.headers.get("Content-Range")).toBe("bytes 5-9/26");
    const post = await streamVerifiedStem(request(undefined, "POST"), fixture);
    expect(post.status).toBe(405);
  });

  it("fails closed for a missing or unsupported registered source", async () => {
    expect((await streamVerifiedStem(request(), fixture + ".missing")).status).toBe(404);
    const other = path.join(dir, "bad-source.exe");
    await fs.writeFile(other, bytes);
    expect((await streamVerifiedStem(request(), other)).status).toBe(404);
  });
});
