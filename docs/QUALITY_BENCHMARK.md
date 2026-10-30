# Vocalizer — Local separation quality evaluation

Status: **benchmark and MDX-Net processing profiles implemented; no Demucs or RoFormer inference enabled yet**.

## Goal

Vocalizer can eventually surpass an online vocal-removal service in offline privacy,
reproducibility, model selection and studio workflow. Whether any model produces
cleaner stems is an **empirical question**, not a UI label or marketing assertion.

## MDX-Net processing profiles

The currently approved local ONNX checkpoint stays unchanged.

| Profile | MDX segment size | Overlap | What this means |
| --- | ---: | ---: | --- |
| Lower memory | 128 | 0.25 | Lower memory use; may increase work |
| Balanced | 256 | 0.25 | Existing baseline |
| Thorough | 256 | 0.50 | More overlapping inference; may be slower, no guaranteed sound-quality win |

All requests cross Zod IPC and the CPU worker's `resolve_profile()` allowlist.
Arbitrary segment sizes and unknown profile names fail closed. Neither the
checkpoint nor nonlocal networking is changed. User-selected profile is displayed
in the Vocal Remover and recorded in job logs.

## Blind, repeatable comparisons

Create an original test mixture with **known, separately recorded ground-truth
vocals and accompaniment**. All WAV files must be sample-aligned uncompressed
signed **16-bit PCM**, mono or stereo, with identical sample rate and frame count.

Export the two resulting stems from each model. Run:

```powershell
python scripts/benchmark-separation.py `
  --mixture "tests/audio/mix.wav" `
  --reference-vocals "tests/audio/ground-truth-vocals.wav" `
  --reference-instrumental "tests/audio/ground-truth-instrumental.wav" `
  --candidate "MDX Balanced" "outputs/mdx-vocals.wav" "outputs/mdx-instrumental.wav" `
  --candidate "Demucs v4" "outputs/demucs-vocals.wav" "outputs/demucs-instrumental.wav" `
  --candidate "RoFormer" "outputs/roformer-vocals.wav" "outputs/roformer-instrumental.wav" `
  --output "reports/local-comparison.json"
```

Only list candidate results that you **actually produced**. The tool doesn't
install models, generate missing stems, or connect to any web service.

If no reference stems are available, omit both `--reference-...` flags, but keep
`--mixture`. The tool then reports mixture reconstruction consistency, which
**cannot prove** vocal separation quality. It never fabricates reference SI-SDR.

For each candidate, inspect:

- Vocal SI-SDR against the known clean vocal reference
- Instrumental SI-SDR against the known clean instrumental reference
- Sum consistency versus the original mixture
- SHA-256 fingerprints for all input files
- Listening checks: vocal bleed, transient smearing, reverb, sibilance, distortion
- Separately measured runtime, RAM usage, and reproducibility on a specified device

The SI-SDR implementation streams samples and removes per-file means; it is
scale-invariant but **not** time-shift invariant. Delays or sample-rate mismatch
must be corrected in a controlled preprocessing step, never automatically
hidden in the metric. Numeric caps ±120 dB avoid infinity in JSON.

## Next engine milestones, intentionally gated

1. Validate MDX balanced/low-memory/thorough with the local, SHA-256-pinned
   checkpoint and a listening corpus; keep one model as a baseline.
2. Add optional **Demucs v4 4-stem** inference *only* when locally installed
   model, frozen worker dependencies, no-network loading and four-output
   verification are proven on Windows. Do not quietly reinterpret two-stem
   result contracts or pretend a four-stem output is a two-stem result.
3. Add **BS-RoFormer/MelBand RoFormer** local checkpoint with verified
   model/config SHA-256, compatible runtime, resource bounds and honest
   per-device support. No implicit checkpoint downloads.
4. Add A/B synchronized playback and blind ratings, batch processing,
   per-model settings, saved projects and latency benchmarks.
5. Verify model and FFmpeg licensing, clean Windows acceptance, offline
   integrity, model-backed inference and long-file cancellation before public
   enterprise distribution.

No default model weights are bundled. Catalog entries with unknown provenance
are intentionally not executable. The offline benchmark is not evidence that
Vocalizer currently beats another system.
