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

from audio_validation import probe, verify_audio_file
from errors import WorkerError
from local_model import DEMUCS_SIGNATURE, require_local_demucs_model

FOUR_STEMS = ("Vocals", "Drums", "Bass", "Other")
# Until bounded decoding is implemented, the whole recording is resident in RAM.
MAX_PREVIEW_INPUT_SECONDS = 600
PROFILES = {
    "low-memory": {"shifts": 1, "overlap": 0.1, "segment": 7},
    "balanced": {"shifts": 1, "overlap": 0.25, "segment": 7},
    "thorough": {"shifts": 2, "overlap": 0.25, "segment": 7},
}


def separate_demucs(
    model_id: str, model_path: str, input_path: str, output_dir: str,
    requested_stems: list[str], output_format: str, device: str,
    profile: str, on_progress,
) -> tuple[list[dict[str, Any]], str, str, bool]:
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
    if input_duration > MAX_PREVIEW_INPUT_SECONDS:
        raise WorkerError(
            "inference-failed",
            "Experimental Demucs preview supports at most 10 minutes per job; "
            "split the recording or use the two-stem workflow.",
        )

    checkpoint = require_local_demucs_model(model_id, model_path)
    try:
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        from demucs.audio import AudioFile, save_audio
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "Demucs 4.0.1 CPU dependencies unavailable.") from exc

    on_progress(None, "Loading verified HTDemucs")
    try:
        # Recheck an isolated copy to close the check/load race for serialized
        # PyTorch checkpoints and keep unrelated .th files out of LocalRepo.
        with TemporaryDirectory(prefix="vocalizer-verified-demucs-") as tmp:
            staged = Path(tmp) / checkpoint.name
            shutil.copyfile(checkpoint, staged)
            require_local_demucs_model(model_id, str(staged))
            # This signature resolves from a private one-file repository.
            model = get_model(DEMUCS_SIGNATURE, repo=staged.parent)
            model.cpu().eval()
        samplerate = model.samplerate
        channels = model.audio_channels
        if set(model.sources) != {x.lower() for x in FOUR_STEMS}:
            raise WorkerError("architecture-unsupported", "Checkpoint has an unexpected source set.")
        wav = AudioFile(Path(input_path)).read(
            streams=0, samplerate=samplerate, channels=channels,
        )
        if wav.ndim != 2 or wav.shape[0] != channels or wav.shape[-1] <= 0:
            raise WorkerError("inference-failed", "Invalid audio waveform.")
        frames = wav.shape[-1]
        duration = frames / samplerate
        reference = wav.mean(0)
        mean = reference.mean()
        scale = reference.std().clamp(min=1e-8)
        mixture = (wav - mean) / scale
        on_progress(None, "Running HTDemucs CPU inference")
        with torch.no_grad():
            estimated = apply_model(
                model, mixture[None], device="cpu",
                split=True, progress=False, num_workers=0, **PROFILES[profile],
            )[0]
            sources = {
                stem: estimated[index] * scale + mean
                for index, stem in enumerate(model.sources)
            }
    except WorkerError:
        raise
    except MemoryError as exc:
        raise WorkerError("out-of-memory", "Insufficient memory for HTDemucs.") from exc
    except Exception as exc:
        raise WorkerError("inference-failed", f"HTDemucs inference failed: {exc}") from exc

    if set(sources) != {name.lower() for name in FOUR_STEMS}:
        raise WorkerError("inference-failed", "Model returned unexpected stem names.")
    for stem, tensor in sources.items():
        if tensor.ndim != 2 or tensor.shape[0] != channels or tensor.shape[-1] != frames:
            raise WorkerError("inference-failed", f"Invalid waveform shape for {stem}.")
        if not bool(torch.isfinite(tensor).all()):
            raise WorkerError("inference-failed", f"Model returned nonfinite audio for {stem}.")

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    suffix = {"wav": ".wav", "wav24": ".wav", "mp3": ".mp3", "flac": ".flac"}[output_format]
    stems: list[dict[str, Any]] = []
    for index, stem in enumerate(FOUR_STEMS):
        target = destination / f"htdemucs_({stem}){suffix}"
        try:
            save_audio(
                sources[stem.lower()].detach().cpu(), target,
                samplerate=samplerate,
                bits_per_sample=24 if output_format == "wav24" else 16,
                bitrate=320,
            )
            verify_audio_file(
                str(target), expected_duration=duration,
                expected_sample_rate=samplerate, expected_channels=channels,
            )
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError("encoding-failed", f"Could not save or verify {stem}: {exc}") from exc
        stems.append({"stem": stem, "path": str(target)})
        on_progress((index + 1) / 4, "Verifying stem outputs")
    on_progress(1.0, "Completed")
    return stems, model_id, "cpu", False
