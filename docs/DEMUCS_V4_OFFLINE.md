# Experimental HTDemucs v4 — local four-stem separation

> **Preview only.** The worker and output path are implemented, but real-model
> Windows acceptance and licensing review are release blockers. CPU inference
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
