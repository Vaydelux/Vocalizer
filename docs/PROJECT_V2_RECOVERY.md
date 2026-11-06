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
