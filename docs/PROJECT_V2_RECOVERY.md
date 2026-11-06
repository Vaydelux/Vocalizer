# Project v2 recovery and audio relinking

Vocalizer project files contain **project metadata only**, never audio samples.
They now retain mixer lane settings (position, mute/solo, volume, pan, DSP,
spatial positioning and automation), plus master bus configuration.

## Restore workflow

1. Save a `.vocalizer` project or allow the local session autosave.
2. Open the saved project. Its mixer lanes and processing settings are restored.
3. Original audio is intentionally marked **missing**. A serialized path or a
   zero-byte placeholder is never treated as playable audio.
4. Use **Relink Audio** in the project bar. Choose the original local files.
5. Vocalizer matches files by exact filename and byte length, independently
   probes the audio, and checks duration against the saved measurement.
   Ambiguous matches, bad decodes and mismatched files stay unavailable.
6. Once each audible mixer lane references a validated source, mixdown is
   enabled. An incomplete mixdown is never silently substituted.

## Compatibility and privacy

- `version: 2` saves mixer details and is strictly schema-validated.
- Existing `version: 1` projects are accepted and migrated to v2 with an
  empty mixer because v1 never saved a mixer snapshot.
- Neither format embeds music data, model weights or executable payloads.
- Saved native file paths are informational only. User action is still required
  to relink. There is no automatic access to arbitrary filesystem locations.
- The project parser enforces size limits and DSP numeric bounds.
- The real audio library still has its 500 MiB per-file import limit.

## Known limitations

- Matching on name + exact size + measured duration is not cryptographic
  source identity. An optional full-file fingerprint can improve this later.
- Mixer files must be manually relinked after process restart.
- Large stems are currently imported into the renderer memory by the mixer
  import path; file-backed audio sources remain a separate optimization.
- Projects from newer, unsupported schema versions are explicitly rejected
  instead of guessing the structure.

Always retain the original source recordings alongside the project metadata.

## Native large-stem relinking (experimental)

On Windows Electron, **Relink Audio** now first offers a privileged OS file
picker for missing stems with Vocalizer's published filename convention:
`Vocalizer-<job-id>-<stem>.wav|flac|mp3`. This path handles stems over the
500 MiB browser import cap without making an in-memory File/Blob copy.

- Main validates that files came from the native picker, are regular files,
  have exactly the saved basename and byte count, and match the recorded
  duration within the existing project-relink tolerance.
- FFprobe measures metadata from disk, never by decoding the entire file into
  renderer RAM. Identity metadata is pinned for the current session so an
  in-place file replacement invalidates playback/processing.
- The original track and mixer lane IDs are preserved, including their
  automation and DSP settings. The project is marked dirty after relinking.
- Session credentials are not persisted. On another restart the same user
  selection must be made again. Native capability tokens and raw file paths
  are never sourced from project JSON. New project saves omit historical
  `nativePath` metadata (older v2 files may still contain it, but it is ignored).
- When no missing published stems remain, **Relink Audio** still falls back to
  the standard file-picker path for other user-imported audio (500 MiB cap).
- A renamed stem or a non-Vocalizer audio file cannot use this specialized
  native path. It does not implement general-purpose large-audio importing.
- This removes a renderer full-file copy, **not** the cost of decoding,
  waveform display, browser `File.arrayBuffer()` DSP, or FFmpeg mixdown.
  Large real-world Windows playback, memory and disk benchmarks are still
  necessary before public release.
