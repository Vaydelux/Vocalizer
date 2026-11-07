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

## Long-session waveform virtualization

The shared player now renders only the currently visible waveform canvas,
regardless of the full duration or horizontal zoom. The horizontally scrollable
layout holds a lightweight spacer whose logical width is capped at 4 million CSS
pixels. The canvas bitmap itself is capped at 8192 physical pixels wide and
tracks the viewport while scrolling.

Pointer seeking, selection regions, and playhead mapping take the horizontal
scroll position into account. The full decoded-waveform threshold remains
unchanged; file-backed large AI stems still skip renderer PCM waveform decoding.
A flat placeholder is intentional when peaks are unavailable. This reduces
canvas allocation pressure and does **not** yet supply low-memory native peak
extraction for giant stems.

A real long-session Windows GUI check should include scroll/zoom/seek across
a two-hour source, high-DPI monitors, project reopen, and resizing during
playback. CI unit coverage checks timeline calculations, not physical UI GPU
memory usage.

## Layered waveform painting (experimental)

The shared WavePlayer now paints two aligned, independently bounded canvas
bitmaps: a static waveform underneath and a transparent interaction overlay
above it. Peak extraction and the rendered waveform are refreshed only when
the source, peaks, zoom, viewport dimensions or visible scroll area change.
Continuous playback updates only selection/playhead pixels in the overlay,
not all peak buckets at animation-frame frequency. Rapid scroll events are
coalesced to at most one viewport repaint per animation frame.

The overlay remains the accessible keyboard/pointer slider (including
shift-drag selection and scroll-relative seeking). The waveform canvas is
marked `aria-hidden` and does not intercept pointer events. A blank peak
layer is intentional for large disk-backed stems without computed peaks.

The shared raster policy caps both layers consistently, including high-DPI
displays. This is a structural CPU/rendering optimization, **not** a measured
claim of better frame times or GPU memory consumption. A clean Windows GUI
test should verify active playback, stopped seek, zoom/scroll, region edits,
track switching, and 60+ minute sessions on normal and high-DPI monitors.

## Incremental waveform peaks and cancellation

For small browser-decodable audio, waveform envelopes are now extracted in
**128-bucket batches** (40 buckets/s visual density), yielding to the event loop
between batches rather than blocking for an entire channel. Each batch checks
the active abort signal: switching sources or unmounting the player aborts
pending peak analysis. The browser metadata preflight also releases its
object URL and timeout immediately on cancellation, before any full file read.
Once an in-flight Web Audio decoder has started it cannot be forcibly
interrupted, but results from abandoned work are not published.

Peak cache entries bind both the track ID and its current media URL, preventing
relinked project audio from inheriting an old waveform when it retains its
track ID. An LRU limit keeps at most **32 MiB** of Float32 peak envelopes, with
older entries evicted; re-opening an evicted track may require peak regeneration.
Each bucket's sample boundaries are proportional to total decoded samples,
including the final sample, rather than repeatedly dropping fractional tails.

This improves responsiveness and peak-cache reliability. Large file-backed
AI stems still use metadata-only preview without renderer full-file decoding.
It does **not** add waveform peak extraction from multi-GB files; that would
require a separate bounded native FFmpeg peak service. Manual long-session
GUI testing remains a release gate.
