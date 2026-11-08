# Native waveform cache — synthetic soak and physical Windows acceptance

This benchmark is a **cache lifecycle test**, not a claim about true 90-minute
audio decoding, playable fidelity, GPU memory or Electron GUI stability.

## Automated synthetic soak

Run:

```powershell
bun scripts/soak-waveform-cache.ts --output reports/cache-soak.json
```

- Builds deterministic 90-minute 40/10/2-Hz min/max envelopes without
  decoding media or downloading an AI model.
- Writes one verified-source binary cache entry, then reopens and hashes it
  **20 times** through the actual cache reader.
- Corrupts one payload byte and requires the checksum to reject the entry.
- Rewrites the entry and requires that recovery succeeds.
- Changes the source file and requires that its previous cache key no longer
  matches.
- Reports elapsed and CPU time, event-loop ticks and sampled process RSS
  growth with generous automated regression guardrails of 45 seconds and
  160 MiB respectively.
- Linux source CI and Windows packaged-preview CI publish commit-tagged
  JSON artifacts for 14 days. Windows CI also executes the cache filesystem
  unit tests directly on NTFS before proceeding to model packaging.

The 90-minute duration represents the number of peak buckets stored; the
synthetic source file is deliberately small. This test does **not** claim to
stream or decode a 90-minute WAV/FLAC/MP3 recording.

## Required physical Windows GUI qualification

Use local test recordings you have the right to process. Run both normal
and high-DPI screens, including a lower-memory Windows machine if available.

1. Import or recover a 60–120 minute verified AI stem. Open its waveform,
   zoom and seek to the beginning, midpoint and end while playing.
2. Close/reopen the project 10 times. Confirm subsequent waveform loads use
   cache hits and the audio source still streams without an in-memory Blob.
3. Modify the source on disk and reopen. It should regenerate peaks rather
   than displaying a stale waveform.
4. Corrupt the application's own waveform cache entry. The next open should
   regenerate gracefully without blocking playback or leaking the source
   filesystem path to the renderer.
5. Simulate an unavailable/read-only or nearly full cache volume. The app
   should still play and process the stem; only cache persistence may fail.
6. Repeat for WAV, FLAC and MP3. Observe CPU, private working set, renderer
   memory and GPU use through Task Manager/Process Explorer. Track a consistent
   before/after baseline, not only peak RSS on an ephemeral CI runner.
7. Cancel waveform extraction mid-scan, switch tracks and immediately close
   the project. Verify the FFmpeg task exits and no new stale waveform is
   surfaced on the next track.

Do not mark public release-ready from CI-only checks. Audio quality and model
redistribution permissions have independent acceptance requirements.
