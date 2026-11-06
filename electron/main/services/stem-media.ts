/**
 * Serve only a stem path already resolved by the privileged completed-job
 * registry. No filesystem path from the renderer ever reaches this helper.
 *
 * Byte-range responses use a Node file stream with bounded buffering, rather
 * than the ambiguous file:// fetch Range behavior. Seeking in multi-GB WAV
 * and FLAC files therefore does not materialize any audio Blob in the UI.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { planMediaByteRange } from "../../shared/media-range";

const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
};

/** `approvedPath` MUST have come from resolveCompletedStemForPlayback. */
export async function streamVerifiedStem(request: Request, approvedPath: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  const mime = MIME[path.extname(approvedPath).toLowerCase()];
  if (!mime) return new Response("Not found", { status: 404 });

  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(approvedPath, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1) {
      await handle.close();
      return new Response("Not found", { status: 404 });
    }
    const plan = planMediaByteRange(request.headers.get("range"), stat.size);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Type": mime,
      "Content-Length": String(plan.length),
      "X-Content-Type-Options": "nosniff",
    });
    if (plan.contentRange) headers.set("Content-Range", plan.contentRange);
    if (plan.status === 416 || request.method === "HEAD") {
      await handle.close();
      return new Response(null, { status: plan.status, headers });
    }

    // FileHandle.createReadStream closes its file descriptor after streaming.
    // The byte window limits the stream itself, even for a multi-GiB source.
    const stream = handle.createReadStream({
      start: plan.start,
      end: plan.end,
      highWaterMark: 64 * 1024,
      autoClose: true,
    });
    // Response streaming observes backpressure; cancellation releases the
    // native descriptor rather than buffering the remaining WAV in memory.
    const abort = () => stream.destroy();
    if (request.signal.aborted) {
      abort();
    } else {
      request.signal.addEventListener("abort", abort, { once: true });
    }
    stream.once("close", () => request.signal.removeEventListener("abort", abort));
    handle = null; // ownership transferred to stream (autoClose)
    return new Response(
      Readable.toWeb(stream) as unknown as ConstructorParameters<typeof Response>[0],
      { status: plan.status, headers },
    );
  } catch {
    if (handle) {
      try { await handle.close(); } catch { /* preserve generic error response */ }
    }
    return new Response("Audio unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
