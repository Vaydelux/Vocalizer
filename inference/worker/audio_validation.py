"""Output validation — verify a produced stem file is real, decodable audio
using FFprobe. This is the verification step the spec demands: do not infer
successful separation from filename creation alone.
"""

from __future__ import annotations
import json
import os
import subprocess
from errors import WorkerError


def probe(path: str) -> dict:
    argv = [
        os.environ.get("LAS_FFPROBE_PATH", "ffprobe"), "-v", "error", "-show_format", "-show_streams",
        "-print_format", "json", path,
    ]
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise WorkerError("encoding-failed", f"FFprobe failed for {path}: {proc.stderr[:200]}")
    return json.loads(proc.stdout)


def verify_audio_file(path: str, expected_duration: float | None = None,
                      tolerance: float = 0.5) -> None:
    import os
    if not os.path.isfile(path):
        raise WorkerError("encoding-failed", f"Output file missing: {path}")
    if os.path.getsize(path) == 0:
        raise WorkerError("encoding-failed", f"Output file is empty: {path}")
    info = probe(path)
    streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise WorkerError("encoding-failed", f"No audio stream in {path}")
    s = streams[0]
    dur = float(s.get("duration") or info.get("format", {}).get("duration") or 0)
    if dur <= 0:
        raise WorkerError("encoding-failed", f"Zero/negative duration for {path}")
    if expected_duration and abs(dur - expected_duration) > tolerance:
        raise WorkerError(
            "encoding-failed",
            f"Duration mismatch for {path}: {dur:.2f}s vs expected {expected_duration:.2f}s",
        )
