# Native file-backed mixer stem sources

Vocalizer now imports completed AI stems into the **desktop mixer** without
fetching entire WAV/FLAC/MP3 files into the renderer heap.

## Architecture

1. The Python worker writes actual stems to a user-selected output directory.
2. Electron main validates and registers **completed** job output paths.
3. The renderer requests a native stem probe using only a verified
   \`{jobId,stem}\` reference; main uses FFprobe to confirm duration, size,
   sample rate and channels.
4. A small \`AudioTrack\` entry records the metadata and verified reference.
   Its \`File\` is an empty sentinel, not audio content. It is never passed
   to browser decoding or disk processing.
5. HTML media sources may use \`las://renderer/__stem-audio/jobId/stem\`,
   which resolves in the privileged main process and supports byte ranges.
6. FFmpeg operations use \`vocalizer-stem:jobId:stem\` aliases. The renderer
   cannot place arbitrary files behind an alias: main looks up the completed
   registry, revalidates the path, then invokes FFmpeg without a shell.
7. Removing a native stem track does not delete the saved source file.
   Completed jobs and outputs can be removed from disk separately by users.

## Why this matters

A 30-minute four-stem WAV render can generate gigabytes of output. The
previous mixer imported every stem through \`fetch().blob()\` and a new
renderer \`File\`, which could exhaust RAM and lose its native filesystem path.
File-backed mixer lanes keep only references and small metadata objects.

## Safety and current limitations

- No arbitrary renderer filesystem paths are accepted by the stem-probe IPC
  or stem-source alias resolver. Both depend on the main-process registry.
- The registry is **session-scoped**; after restarting, the user must use
  **Relink Audio** to reconnect original saved stems. Project v2 stores
  metadata, not audio bytes or a persistently trusted native capability.
- Non-native browser preview cannot register native-backed stems.
- Browser-only tools that require \`File.arrayBuffer()\` cannot process a
  disk-backed track directly. Native FFmpeg operations and mixer mixdown can.
- This prevents renderer-side full-file Blob copies. Peak memory still depends
  on the media player/decoder, playback length, active DSP, and Electron.
  Quantitative before/after memory profiling remains a release criterion.
- The saved stem must remain accessible on disk. If moved or deleted, native
  resolution fails rather than silently creating an empty mixdown.

## Streaming and seeking (native desktop)

The `las://renderer/__stem-audio/<jobId>/<stem>` endpoint now serves a
real HTTP-style byte-range response directly from a verified file handle.
Chromium's audio player can ask for `Range: bytes=start-end` without the
renderer fetching the entire recording.

- `200` for full GET requests; `206` and `Content-Range` for a valid
  single byte range; `416` for malformed/unsatisfiable ranges.
- Supports HEAD for metadata checks. Rejects unsupported HTTP methods and
  multipart ranges, and sets `Cache-Control: no-store`.
- Node streams use 64 KiB chunks with backpressure and release the file
  descriptor when complete or cancelled. Byte offset planning supports files
  beyond 4 GiB without 32-bit arithmetic.
- Only the main-process completed/relinked stem registry can resolve a
  playback source; no filesystem path is accepted from the URL.
- This improves the transport layer; it does **not** certify fast seek
  accuracy for every codec or eliminate decoder/FFmpeg memory usage.
  Real long-session Windows playback and memory benchmarks remain gates.

## Reproducible synthetic transport benchmark

The CI source and Windows preview workflows now run:

```powershell
bun scripts/benchmark-stem-stream.ts --output reports/stem-stream.json
```

This creates a temporary **sparse 512 MiB file** with known byte markers,
requests verified 2 MiB byte ranges at the beginning, middle, and end
(four repetitions), and compares SHA-256 digests of actual returned bytes.
It produces a compact JSON artifact recording the source commit, request
count, bytes received, process CPU time, wall time, and **sampled** process
RSS increase. The regression guardrail is a generous 256 MiB sampled RSS
increase, not a claim of a fixed memory usage across all machines.

CI retains Linux and Windows metrics artifacts for 14 days. These metrics
cover a synthetic streaming transport path, **not** the private working set
of the Electron renderer, audio decoding, listening quality, long-session
playback smoothness, disk throughput with real compressed media, or user
hardware. Compare measurements only on like-for-like machines and test
fixtures. Windows GUI memory and repeated real-song audition remain mandatory
manual acceptance gates.
