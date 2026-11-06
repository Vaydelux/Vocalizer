# Experimental HTDemucs v4 — local four-stem separation

> **Preview only.** Real single-window Windows inference was verified, but
> long-form chunked inference and licensing review remain release gates. CPU inference
> can be slow or RAM-intensive; no GPU runtime is currently packaged.

## Checkpoint provenance and integrity

- Model: official Meta HTDemucs v4 single model, signature `955717e8`.
- Required filename: `955717e8-8726e21a.th`.
- Source: https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th
- Full upstream SHA-256:
  `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`.
- Reference manifest: https://github.com/nomadkaraoke/python-audio-separator/blob/main/audio_separator/model-checksums.json
- No weights are included in Vocalizer. Obtain only if you have permission to
  use the model. Verify licensing and the upstream model notice before
  redistributing any checkpoint.

**PowerShell** (check a user-obtained file):

```powershell
(Get-FileHash -Algorithm SHA256 "C:\Models\955717e8-8726e21a.th").Hash
```

It must match the SHA-256 above. Both Electron and Python independently
validate it before execution. Do not rename other models to pass validation:
the checksum will reject them. Demucs is passed an explicit local `repo` and
model signature, so the inference code cannot silently retrieve missing models.

## Using the development build

1. Build or obtain a Vocalizer Windows debug preview with the packaged worker.
2. Import a local audio file with a real filesystem path.
3. Open **Stem Splitter**, choose **Demucs v4 (Hybrid HTDemucs 4-Stem)**.
4. Select the locally obtained `955717e8-8726e21a.th` checkpoint.
5. Choose the CPU and an inference profile, then choose a destination folder.
6. Start separation; results must consist of **Vocals, Drums, Bass, Other**.
7. Open stems from the completed job or send decodable, within-limit files
   to the Mixer. The app will not publish partial sets.

Output files are published atomically in the sense that failed staging or
publishing rolls back newly created output files. An existing destination file
is never overwritten. Cancellation kills the isolated inference child, and
private scratch is cleaned up.

## Acceptance before considering general release

- Verify PyInstaller packaged `demucs`, `torchaudio` and native DLL imports.
- Run actual short stereo, mono and long stereo songs on Windows x64 **offline**.
- Confirm the four decodable stems, stereo shape, sample rate, nonzero lengths,
  matching durations, and genuine distinct audio content.
- Test WAV16/WAV24/FLAC/MP3 outputs, cancellation mid-song, restart, two
  consecutive jobs, low-RAM settings, full disk, and file-name collisions.
- Confirm no background model downloads; audit network connections during
  offline inference. The **source-level contract tests use stubs** and do not
  count as quality or model-backed acceptance.
- Record real CPU time, memory peak, and SDR/SI-SDR on licensed reference
  multitrack material before comparing quality claims.
- Review Demucs code license and checkpoint redistribution rights separately
  before bundling or distributing model weights.

RoFormer, DirectML and CUDA are not enabled by this feature.

## Safety limits during preview

The streaming Demucs implementation decodes at most one short window at a time.
It processes up to **30 minutes of audio**, with an FFprobe input-duration gate,
free-disk preflight, and output streaming through float WAV scratch files.
Adjacent chunk cores use a **0.25-second crossfade** with **3 seconds of
inference context** on both sides. Low Memory uses 8-second cores; Balanced and
Thorough use 24-second cores. Output files are only finalized after all four
stem streams have been rendered and verified.

A single final peak gain per stem is measured over the complete float stream
and applied during final PCM16/PCM24/FLAC/MP3 encoding; this avoids per-chunk
volume pumping. The application checks sample counts, duration, channels and
sample rates; failure or cancellation cannot be mistaken for a completed
four-stem job.

This is a **preview limit**, not an assurance that a 30-minute source will finish
quickly on every CPU. Outputs require substantial scratch disk space and may
take many times the source runtime. Users must retain the original file and
enough temporary storage. Source metadata must have a reliable duration.
Very long files require future resumable chunk/session orchestration.

Because PyTorch model files use object serialization, the hash-verified model
is copied into a private one-file repository and the copied bytes are hashed
**again** before they are deserialized. This mitigates a checkpoint replacement
race between initial verification and model loading. Neither the worker nor
Windows CI bundles weights into the user-facing ZIP.

## Long-form acceptance gate

Windows CI runs the actual packaged HTDemucs CPU worker on 3-second and
9-second stereo test inputs. The 9-second input forces **two 8-second cores**;
each of the four output files must be 24-bit stereo PCM with the same
sample-accurate length as the input (within FFprobe reporting tolerance).
The 3-second test protects single-window behavior and the 9-second test
protects crossfade continuity. This is a structural test only: perceptual seam
quality, SDR/SI-SDR and hour-long operation still require real-song testing.
