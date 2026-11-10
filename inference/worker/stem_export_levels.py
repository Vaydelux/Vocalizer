"""Preserve RoFormer stem-to-stem level relationships during export.

Independent peak normalization changes the ratio of vocals to instrumental,
and can break sum-to-mixture reconstruction. Apply no gain for signals already
within the PCM ceiling; if one stem exceeds it, attenuate *every* stem by the
same scalar. This helper intentionally needs no NumPy/PyTorch dependency so
source CI can catch unsafe level math before Windows packaging.
"""
from __future__ import annotations

import math
from typing import Iterable

from errors import WorkerError

PCM_PEAK_CEILING = 0.999


def shared_pcm_export_gain(
    stem_peaks: Iterable[float],
    ceiling: float = PCM_PEAK_CEILING,
) -> float:
    """Return a common 0 < gain <= 1 to prevent PCM clipping.

    Accept precomputed absolute peaks; do not inspect or copy whole stem
    buffers in this helper. NaN, infinity and invalid peaks must stop export
    rather than silently generating damaged WAV/MP3 files.
    """
    if not math.isfinite(ceiling) or not 0.0 < ceiling < 1.0:
        raise ValueError("PCM peak ceiling must be finite and strictly between 0 and 1.")
    highest = 0.0
    count = 0
    for raw in stem_peaks:
        value = float(raw)
        if not math.isfinite(value) or value < 0:
            raise WorkerError("encoding-failed", "RoFormer produced a non-finite or invalid stem peak.")
        highest = max(highest, value)
        count += 1
    if count == 0:
        raise WorkerError("encoding-failed", "RoFormer produced no audio stems.")
    return min(1.0, ceiling / highest) if highest > 0 else 1.0
