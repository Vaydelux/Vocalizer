"""Validated MDX-Net inference presets. Not a guarantee of audio quality.

The model, encoding format and file verification remain unchanged.
'thorough' increases overlap; the measured benefit depends on the song/model.
"""
from __future__ import annotations

from errors import WorkerError

PRESETS = {
    "low-memory": {"segment_size": 128, "overlap": 0.25},
    "balanced": {"segment_size": 256, "overlap": 0.25},
    "thorough": {"segment_size": 256, "overlap": 0.5},
}

def resolve_profile(profile: str, segment_size: int | None = None) -> dict[str, float | int]:
    if profile not in PRESETS:
        raise WorkerError("inference-failed", "Unknown inference profile.")
    selected = dict(PRESETS[profile])
    # Explicit legacy standalone knob is limited to tested MDX sizes.
    if segment_size is not None:
        if type(segment_size) is not int or segment_size not in (128, 256):
            raise WorkerError("inference-failed", "Unsupported MDX segment size.")
        selected["segment_size"] = segment_size
    return selected
