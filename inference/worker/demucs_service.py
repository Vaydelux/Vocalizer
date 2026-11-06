
"""Run the approved HTDemucs four-stem model entirely from a local checkpoint.

An explicit local repo + signature prevents the upstream library from fetching
weights. Torch checkpoints are deserialized only after full SHA-256 verification.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from audio_validation import verify_audio_file
from errors import WorkerError
from local_model import DEMUCS_SIGNATURE, require_local_demucs_model

FOUR_STEMS = ("Vocals", "Drums", "Bass", "Other")
PROFILES = {
    "low-memory": {"shifts": 1, "overlap": 0.1, "segment": 7},
    "balanced": {"shifts": 1, "overlap": 0.25, "segment": 7},
    "thorough": {"shifts": 2, "overlap": 0.25, "segment": 7},
}


def separate_demucs(
    model_id: str,
    model_path: str,
    input_path: str,
    output_dir: str,
    requested_stems: list[str],
    output_format: str,
    device: str,
    profile: str,
    on_progress,
) -> tuple[list[dict[str, Any]], str, str, bool]:
    if device not in ("cpu", "auto"):
        raise WorkerError("device-unsupported", "This Demucs build supports CPU inference only.")
    if len(requested_stems) != 4 or set(requested_stems) != set(FOUR_STEMS):
        raise WorkerError("architecture-unsupported", "Demucs requires the four exact real stems.")
    if output_format not in ("wav", "wav24", "mp3", "flac"):
        raise WorkerError("encoding-failed", "Unsupported Demucs output format.")
    if profile not in PROFILES:
        raise WorkerError("inference-failed", "Unrecognized Demucs inference profile.")
    checkpoint = require_local_demucs_model(model_id, model_path)

    on_progress(None, "Loading verified local HTDemucs")
    try:
        from demucs.api import Separator as DemucsSeparator
        from demucs.audio import save_audio
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "Demucs CPU runtime is not bundled.") from exc

    try:
        # The signature resolves within this one local directory, never remotely.
        separator = DemucsSeparator(
            model=DEMUCS_SIGNATURE, repo=checkpoint.parent, device="cpu",
            jobs=0, progress=False, **PROFILES[profile],
        )
        on_progress(None, "Running Demucs inference")
        _, sources = separator.separate_audio_file(Path(input_path))
    except MemoryError as exc:
        raise WorkerError("out-of-memory", "Not enough RAM for Demucs separation.") from exc

    if not isinstance(sources, dict) or set(sources) != {s.lower() for s in FOUR_STEMS}:
        raise WorkerError("inference-failed", "Demucs returned missing or unexpected sources.")

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    extension = {"wav": ".wav", "wav24": ".wav", "mp3": ".mp3", "flac": ".flac"}[output_format]
    stems: list[dict[str, Any]] = []
    for index, name in enumerate(FOUR_STEMS):
        result = destination / f"{Path(input_path).stem}_({name})_htdemucs{extension}"
        try:
            save_audio(
                sources[name.lower()].detach().cpu(),
                result, samplerate=separator.samplerate,
                bits_per_sample=24 if output_format == "wav24" else 16,
                bitrate=320,
            )
            verify_audio_file(str(result))
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError("encoding-failed", f"Could not save/verify {name}: {exc}") from exc
        stems.append({"stem": name, "path": str(result)})
        on_progress((index + 1) / 4, "Verifying outputs")

    on_progress(1.0, "Completed")
    return stems, model_id, "cpu", False
