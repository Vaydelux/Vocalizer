# Local BS-RoFormer / Mel-Band RoFormer checkpoint preview

This feature is designed for **existing local** `model.safetensors` and
`config.yaml` pairs. The model files are not part of Vocalizer's repository,
the Windows debug ZIP, or any model-download feature. They are never uploaded.

## Model folder layout

Keep the directory structure unchanged:

```text
local/
├── bs_roformer/
│   ├── multistem/
│   │   ├── model.safetensors
│   │   └── config.yaml
│   └── vocals_viperx/
│       ├── model.safetensors
│       └── config.yaml
└── mel_band_roformer/
    ├── vocals_viperx/
    │   ├── model.safetensors
    │   └── config.yaml
    ├── 4stems_large/
    │   ├── model.safetensors
    │   └── config.yaml
    └── ...other locally downloaded variants
```

## Use with the Windows debug build

1. Import a **short, legally usable track (30 seconds maximum)** in Home.
2. Open **Stem Splitter**. The default model choice is local Mel-Band RoFormer
   vocals. Choose BS-RoFormer Vocals or a matching 4-Stem preset instead as
   appropriate for the actual model.
3. Choose the corresponding `model.safetensors` file from the existing folder.
   Vocalizer uses the sibling `config.yaml`; do not rename files or change
   their structure.
4. Select **CPU** (CUDA/DirectML is not yet enabled), then an export format and
   processing profile. The current RoFormer CPU preview uses the YAML's chunk
   length and overlap. Profiles do not override the model architecture.
5. Start separation and pick a writable **new destination directory**. Check
   Processing Queue for progress or a structured error.
6. Play the saved Vocals/Instrumental or Vocals/Drums/Bass/Other files. The
   files should be distinct and have the same measured duration as your source.
   Test repeat runs, cancellation, and changing models before longer use.

## Compatibility limits and honest errors

- The model family is detected from architecture parameters *inside the YAML*
  (BS: `freqs_per_bands`; MelBand: `num_bands`). Folder names are only for
  your convenience. An incompatible family or missing companion config fails.
- Only verified **vocals + instrumental** or **vocals + drums + bass + other**
  stem naming is enabled. The `denoise`, `dereverb`, custom instrumental,
  guitar/piano, or other specialized configurations must receive their own
  truthful output labels/workflows before becoming selectable as those jobs.
- RoFormer weights are loaded through the **safetensors** parser followed by
  **strict** PyTorch state-dict matching. Serialized Python/pickle checkpoints,
  unknown YAML Python tags, auto-downloads and silent partial parameter loading
  are prohibited.
- RoFormer CPU preview limits inputs to 30 seconds and 256 MiB while memory
  behavior is measured. Large checkpoints may still exceed available RAM.
- Vocalizer bundles an MIT-licensed MSST-compatible inference architecture
  alongside `BS-RoFormer==1.4.0`. Converted MSST models use the matching
  original topology, including `mlp_expansion_factor: 2` where specified.
  Modern upstream-only architecture settings use the corresponding upstream
  class instead. See `inference/worker/msst_roformer/LICENSE` for the retained
  copyright and license.
- Some converted checkpoints may still use a different key namespace or custom
  model head that is **not** implemented. A strict state-dict mismatch is
  reported explicitly; Vocalizer never loads only a subset of the weights.
  Do **not** rename, convert, or discard your weights to circumvent this.
  Loading the actual checkpoint on your Windows computer remains necessary
  before saying that variant works.
- Windows CI generates original small MSST BS-RoFormer and Mel-Band
  RoFormer safetensors checkpoints, then verifies real model inference through
  the packaged worker, the two possible single-target output shapes, and
  decoded audio files. These *synthetic* checks do **not** prove that your
  actual checkpoints have compatible tensor names/shapes or good music
  separation quality. Test those files locally before a public release.
- FFmpeg decoding is capped before buffers are collected, limiting the
  preview to 30 seconds. This is not yet a full-song streaming release.

## Troubleshooting

- **Model not found** — verify `model.safetensors` and `config.yaml` are
  regular sibling files in the same directory, not shortcuts/symlinks.
- **Architecture unsupported** — check the preset family and the actual
  config's `num_bands` / `freqs_per_bands`. If strict state-dict loading
  reports a mismatch, the checkpoint requires an architecture-matched runtime.
- **Low memory** — use a short clip, close memory-intensive applications and
  choose a smaller compatible model. Do not assume `low-memory` profile
  reduces neural-network parameter memory.
- **Incorrect stems** — output-label verification blocks unknown semantics;
  no arbitrary denoise stem will be passed off as "Vocals".

Source references: AEmotionStudio's model collections and lucidrains
BS-RoFormer architecture (license and redistribution terms should be reviewed
for each actual checkpoint before redistribution).
