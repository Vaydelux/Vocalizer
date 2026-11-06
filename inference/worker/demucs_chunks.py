"""Deterministic, sample-exact window planning for bounded Demucs inference.

The model receives extra left/right context, while only core samples are
exported. Adjacent cores overlap by a short crossfade interval; each input
frame contributes to exactly one reconstructed output frame.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class ChunkWindow:
    core_start: int
    core_stop: int
    decode_start: int
    decode_stop: int

    @property
    def core_frames(self) -> int:
        return self.core_stop - self.core_start

    @property
    def offset_frames(self) -> int:
        return self.core_start - self.decode_start


def plan_chunks(
    total_frames: int,
    sample_rate: int,
    core_seconds: float = 24.0,
    context_seconds: float = 3.0,
    crossfade_seconds: float = 0.25,
) -> tuple[list[ChunkWindow], int]:
    """Build bounded windows (no overlapping/dropped frames after stitching)."""
    if total_frames <= 0 or sample_rate <= 0:
        raise ValueError("Audio duration and sample rate must be positive.")
    values = (core_seconds, context_seconds, crossfade_seconds)
    if not all(math.isfinite(x) and x >= 0 for x in values):
        raise ValueError("Chunk settings must be finite and nonnegative.")
    core = round(sample_rate * core_seconds)
    context = round(sample_rate * context_seconds)
    fade = round(sample_rate * crossfade_seconds)
    if not 0 < fade < core or context < fade or core > sample_rate * 60:
        raise ValueError("Chunk settings require bounded core and context >= overlap.")
    windows: list[ChunkWindow] = []
    start = 0
    while start < total_frames:
        stop = min(total_frames, start + core)
        windows.append(ChunkWindow(
            core_start=start,
            core_stop=stop,
            decode_start=max(0, start - context),
            decode_stop=min(total_frames, stop + context),
        ))
        if stop == total_frames:
            break
        start = stop - fade
    for previous, current in zip(windows, windows[1:]):
        if previous.core_stop - current.core_start != fade:
            raise ValueError("Non-contiguous core overlap.")
    return windows, fade
