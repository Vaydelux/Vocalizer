"""Strict matching of real audio-separator output filenames to requested stems.

No fallback to the first requested stem: that could make an unknown output look
like a legitimate second audio track.
"""
from __future__ import annotations

from pathlib import Path

from errors import WorkerError

ALLOWED_STEMS = frozenset(("Vocals", "Instrumental"))


def match_stems(file_names: list[str], requested: list[str]) -> list[str]:
    if len(requested) != 2 or set(requested) != ALLOWED_STEMS:
        raise WorkerError("architecture-unsupported", "The MDX-Net preview supports Vocals and Instrumental only.")
    if len(file_names) != len(requested):
        raise WorkerError("inference-failed", "The model did not return exactly two audio outputs.")

    matched: list[str] = []
    for name in file_names:
        lower = Path(name).name.lower()
        tokens = [stem for stem in requested if f"({stem.lower()})" in lower]
        if len(tokens) != 1:
            raise WorkerError("inference-failed", f"Cannot identify one unambiguous stem in output: {Path(name).name}")
        stem = tokens[0]
        if stem in matched:
            raise WorkerError("inference-failed", "The model returned duplicate stems; output cannot be trusted.")
        matched.append(stem)
    if set(matched) != set(requested):
        raise WorkerError("inference-failed", "One or more requested stems are missing.")
    return matched
