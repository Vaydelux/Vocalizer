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
