# Model Provenance Record — UVR-MDX-NET-Inst_HQ_5.onnx

Recorded from the **actual downloaded file** used for the verified CPU
separation (Phase 5.1/5.2). This file documents provenance for engineering
verification; it does **not** constitute redistribution permission.

| Field | Value |
|---|---|
| Filename | `UVR-MDX-NET-Inst_HQ_5.onnx` |
| SHA-256 | `811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000` |
| Size | 59,074,342 bytes (~59 MB) |
| Architecture | MDX-Net |
| Format | ONNX |
| Output stems | Vocals, Instrumental (2-stem) |
| Source | `https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_5.onnx` |
| Publisher | TRvlvr (UVR / Ultimate Vocal Remover project) |
| Runtime | ONNX Runtime CPU (verified 1.31.1, CPUExecutionProvider) |
| CPU compatible | YES — verified (~22 s for 10 s audio, ~2.6 GB peak RSS) |
| License | **UNVERIFIED** — see below |
| Redistribution | **NOT PERMITTED until verified** |

## Redistribution gate (BLOCKED)

A publicly downloadable model is **not automatically redistributable**. Before
this checkpoint may be embedded in a distributable installer:

1. Locate the model's license statement in the UVR model repo / application.
2. Confirm redistribution and commercial-use terms in writing.
3. Record attribution requirements.
4. Re-verify the SHA-256 of the exact file to be bundled.

Until then: the model is downloaded at runtime for engineering verification
only, is NOT committed to this repository, and the bundled-default slot in the
Model Manager remains `not-installed` and protected.

If rights cannot be confirmed, an alternative must be identified and validated
with the same pipeline before bundling — with no substitution of an unverified
checkpoint.
