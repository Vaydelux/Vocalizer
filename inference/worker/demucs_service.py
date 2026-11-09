"""Offline HTDemucs v4 four-stem CPU inference using Demucs 4.0.1 modules.

Version 4.0.1 has no demucs.api. Use its local pretrained repository,
AudioFile, apply_model and save_audio functions instead. The selected .th
must pass a full SHA-256 check before the torch deserialization step.
"""
from __future__ import annotations
from pathlib import Path
from typing import Any
from tempfile import TemporaryDirectory
import math
import shutil

from audio_validation import probe
from demucs_streaming import MAX_LONG_INPUT_SECONDS, render_streaming_stems
from errors import WorkerError
from audio_encoding_options import require_mp3_bitrate
from local_model import DEMUCS_SIGNATURE, require_local_demucs_model

FOUR_STEMS = ("Vocals", "Drums", "Bass", "Other")
PROFILES = {
    "low-memory": {"shifts": 1, "overlap": 0.1, "segment": 7},
    "balanced": {"shifts": 1, "overlap": 0.25, "segment": 7},
    "thorough": {"shifts": 2, "overlap": 0.25, "segment": 7},
}


def separate_demucs(
    model_id: str, model_path: str, input_path: str, output_dir: str,
    requested_stems: list[str], output_format: str, device: str,
    profile: str, on_progress, mp3_bitrate: int = 320,
) -> tuple[list[dict[str, Any]], str, str, bool]:
    mp3_bitrate = require_mp3_bitrate(mp3_bitrate)
    if device not in ("cpu", "auto"):
        raise WorkerError("device-unsupported", "Only CPU is supported in this Demucs build.")
    if len(requested_stems) != 4 or set(requested_stems) != set(FOUR_STEMS):
        raise WorkerError("architecture-unsupported", "Demucs requires exactly four distinct stems.")
    if output_format not in ("wav", "wav24", "mp3", "flac"):
        raise WorkerError("encoding-failed", "Unsupported output format.")
    if profile not in PROFILES:
        raise WorkerError("inference-failed", "Unknown Demucs profile.")
    if not Path(input_path).is_file():
        raise WorkerError("inference-failed", "Audio input file does not exist.")

    # A full-song decode produces large in-memory tensors. Reject very long
    # recordings before allocating waveforms until streaming is implemented.
    try:
        metadata = probe(input_path)
        audio_streams = [stream for stream in metadata.get("streams", [])
                         if stream.get("codec_type") == "audio"]
        if not audio_streams:
            raise WorkerError("inference-failed", "Input has no audio stream.")
        raw_duration = (metadata.get("format", {}).get("duration")
                        or audio_streams[0].get("duration"))
        input_duration = float(raw_duration)
    except WorkerError:
        raise
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        raise WorkerError("inference-failed", "Audio input has no reliable duration.") from exc
    if not math.isfinite(input_duration) or input_duration <= 0:
        raise WorkerError("inference-failed", "Audio input duration is invalid.")
    if input_duration > MAX_LONG_INPUT_SECONDS:
        raise WorkerError(
            "inference-failed",
            "Experimental Demucs supports recordings up to 30 minutes. "
            "Longer files require a future disk-capacity-aware batch workflow.",
        )

    checkpoint = require_local_demucs_model(model_id, model_path)
    try:
        from demucs.pretrained import get_model
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "Demucs 4.0.1 CPU dependencies unavailable.") from exc

    on_progress(None, "Loading verified local HTDemucs")
    try:
        # The pinned PyTorch checkpoint is deserialized only after copying it
        # into a private repository and checking the copy's full digest again.
        with TemporaryDirectory(prefix="vocalizer-verified-demucs-") as tmp:
            staged = Path(tmp) / checkpoint.name
            shutil.copyfile(checkpoint, staged)
            require_local_demucs_model(model_id, str(staged))
            model = get_model(DEMUCS_SIGNATURE, repo=staged.parent)
            model.cpu().eval()
        if set(model.sources) != {stem.lower() for stem in FOUR_STEMS}:
            raise WorkerError("architecture-unsupported", "Checkpoint is not the verified four-stem model.")
        stems = render_streaming_stems(
            model=model,
            input_path=input_path,
            output_dir=output_dir,
            output_format=output_format,
            profile=PROFILES[profile],
            input_duration=input_duration,
            on_progress=on_progress,
            chunk_seconds=8 if profile == "low-memory" else 24,
            mp3_bitrate=mp3_bitrate,
        )
    except WorkerError:
        raise
    except MemoryError as exc:
        raise WorkerError("out-of-memory", "Insufficient memory for bounded HTDemucs inference.") from exc
    except Exception as exc:
        raise WorkerError("inference-failed", f"HTDemucs inference failed: {exc}") from exc

    if len(stems) != 4 or {entry["stem"] for entry in stems} != set(FOUR_STEMS):
        raise WorkerError("inference-failed", "Incomplete Demucs stem result; refusing success.")
    return stems, model_id, "cpu", False
