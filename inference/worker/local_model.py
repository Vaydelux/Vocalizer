"""Fail-closed local checkpoint validation for the tested CPU MDX-Net model.

Model weights are NOT distributed with Vocalizer until the legal redistribution
review is complete. An end user can select a lawfully obtained checkpoint for
internal testing. A missing/modified file must never trigger an implicit
download during an offline separation job.
"""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from errors import WorkerError

MODEL_FILENAME = "UVR-MDX-NET-Inst_HQ_5.onnx"
MODEL_SHA256 = "811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000"
MODEL_SIZE = 59074342


def require_local_mdx_model(
    model_id: str,
    model_path: str,
    expected_sha256: str = MODEL_SHA256,
    expected_size: int = MODEL_SIZE,
) -> Path:
    if model_id != MODEL_FILENAME:
        raise WorkerError("architecture-unsupported", "Only the verified MDX-Net HQ 5 model can run in this preview.")
    candidate = Path(model_path)
    if not candidate.is_absolute() or candidate.name != MODEL_FILENAME:
        raise WorkerError("model-not-found", "Select the absolute path to the local verified ONNX model.")
    if not candidate.is_file():
        raise WorkerError("model-not-found", "The selected model file is missing; automatic download is disabled.")
    if candidate.stat().st_size != expected_size:
        raise WorkerError("model-corrupted", "Model file size does not match the verified checkpoint.")

    digest = sha256()
    try:
        with candidate.open("rb") as stream:
            for data in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(data)
    except OSError as exc:
        raise WorkerError("model-not-found", f"Cannot read the local model file: {exc}") from exc

    if digest.hexdigest().lower() != expected_sha256.lower():
        raise WorkerError("model-corrupted", "Model SHA-256 does not match the verified checkpoint.")
    return candidate.resolve()

# Pinned official HTDemucs v4 single-model checkpoint. Model weights are never
# redistributed or downloaded by Vocalizer during an inference request.
DEMUCS_FILENAME = "955717e8-8726e21a.th"
DEMUCS_SIGNATURE = "955717e8"
DEMUCS_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"


def require_local_demucs_model(
    model_id: str, model_path: str, expected_sha256: str = DEMUCS_SHA256,
) -> Path:
    """Verify exact upstream checkpoint before deserializing PyTorch .th data."""
    if model_id != DEMUCS_FILENAME:
        raise WorkerError("architecture-unsupported", "Only hash-pinned HTDemucs v4 is enabled.")
    candidate = Path(model_path)
    if not candidate.is_absolute() or candidate.name != DEMUCS_FILENAME:
        raise WorkerError("model-not-found", "Select the local HTDemucs checkpoint by its exact filename.")
    if not candidate.is_file() or candidate.is_symlink():
        raise WorkerError("model-not-found", "HTDemucs checkpoint missing or linked; downloads are disabled.")
    digest = sha256()
    try:
        with candidate.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise WorkerError("model-not-found", f"Cannot read checkpoint: {exc}") from exc
    if digest.hexdigest() != expected_sha256:
        raise WorkerError("model-corrupted", "HTDemucs checkpoint SHA-256 failed verification.")
    return candidate.resolve()
