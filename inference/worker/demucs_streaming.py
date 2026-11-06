"""Bounded long-form HTDemucs rendering and sample-exact WAV/FLAC/MP3 export.

Every inference window is short, with context around the exported core.
Adjacent cores crossfade by a fixed number of samples. Only one window and
the previous overlap tail are resident in memory at any moment.

Intermediate floats are written without clipping. Final encodes apply one
measured global peak gain per stem, avoiding per-chunk volume pumping.
"""
from __future__ import annotations

from contextlib import ExitStack
import math
import os
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any

from audio_validation import verify_audio_file
from demucs_chunks import plan_chunks
from errors import WorkerError

STEMS = ("Vocals", "Drums", "Bass", "Other")
MAX_LONG_INPUT_SECONDS = 1800
SAMPLE_RATE_LIMIT = 48000
# Each 24-second core is decoded with 3 seconds of context on either side.
CORE_SECONDS = 24
CONTEXT_SECONDS = 3
CROSSFADE_SECONDS = 0.25


def required_disk_bytes(duration: float, samplerate: int, channels: int) -> int:
    """Reserve float scratch + final 32-bit upper bound + 20% safety."""
    samples = math.ceil(duration * samplerate)
    return math.ceil(samples * channels * len(STEMS) * (4 + 4) * 1.2) + 256 * 1024 * 1024


def render_streaming_stems(
    *,
    model: Any,
    input_path: str,
    output_dir: str,
    output_format: str,
    profile: dict[str, float | int],
    input_duration: float,
    on_progress,
    chunk_seconds: float = CORE_SECONDS,
) -> list[dict[str, str]]:
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from demucs.audio import AudioFile
        from demucs.apply import apply_model
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "Streaming Demucs needs numpy, soundfile and torch.") from exc

    samplerate = int(model.samplerate)
    channels = int(model.audio_channels)
    if samplerate <= 0 or samplerate > SAMPLE_RATE_LIMIT or channels not in (1, 2):
        raise WorkerError("architecture-unsupported", "Unsupported model sample rate or channel count.")
    if not math.isfinite(input_duration) or input_duration <= 0 or input_duration > MAX_LONG_INPUT_SECONDS:
        raise WorkerError("inference-failed", "This preview supports recordings up to 30 minutes.")
    if set(model.sources) != {stem.lower() for stem in STEMS}:
        raise WorkerError("architecture-unsupported", "The selected checkpoint is not a four-stem model.")
    if output_format not in ("wav", "wav24", "flac", "mp3"):
        raise WorkerError("encoding-failed", "Unsupported output format.")

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    disk = shutil.disk_usage(destination).free
    required = required_disk_bytes(input_duration, samplerate, channels)
    if disk < required:
        raise WorkerError(
            "encoding-failed",
            f"Not enough free space for four-stem rendering. Need about {math.ceil(required / (1024**3))} GiB.",
        )

    total_frames = round(input_duration * samplerate)
    windows, fade = plan_chunks(
        total_frames, samplerate, core_seconds=chunk_seconds,
        context_seconds=CONTEXT_SECONDS, crossfade_seconds=CROSSFADE_SECONDS,
    )

    scratch_paths = {stem: destination / f"htdemucs_{stem}.float.wav" for stem in STEMS}
    suffix = {"wav": "wav", "wav24": "wav", "flac": "flac", "mp3": "mp3"}[output_format]
    output_paths = {stem: destination / f"htdemucs_({stem}).{suffix}" for stem in STEMS}
    for filename in list(scratch_paths.values()) + list(output_paths.values()):
        if filename.exists():
            raise WorkerError("encoding-failed", "A scratch output file already exists. Use a fresh job folder.")

    # The parent worker owns this per-job directory and cleans it up on
    # cancellation. Still remove our float intermediates for normal completion
    # or any caught exception.
    peak = {stem: 0.0 for stem in STEMS}
    written_frames = {stem: 0 for stem in STEMS}
    tails: dict[str, Any] = {}
    chunk_count = len(windows)
    started = time.perf_counter()
    try:
        with ExitStack() as stack:
            writers = {
                stem: stack.enter_context(sf.SoundFile(
                    str(scratch_paths[stem]), mode="w", samplerate=samplerate,
                    channels=channels, format="WAV", subtype="FLOAT",
                ))
                for stem in STEMS
            }
            source_file = AudioFile(Path(input_path))
            for chunk_index, window in enumerate(windows):
                on_progress(
                    chunk_index / chunk_count * 0.9,
                    f"Separating chunk {chunk_index + 1} of {chunk_count}",
                )
                # AudioFile.read bounds FFmpeg decoding to this window only.
                duration = (window.decode_stop - window.decode_start) / samplerate
                waveform = source_file.read(
                    seek_time=window.decode_start / samplerate,
                    duration=duration,
                    streams=0, samplerate=samplerate, channels=channels,
                )
                if waveform.ndim != 2 or waveform.shape[0] != channels:
                    raise WorkerError("inference-failed", "Decoded chunk has invalid channel layout.")
                if waveform.shape[-1] < window.offset_frames + window.core_frames:
                    raise WorkerError(
                        "inference-failed",
                        "Audio decoder returned fewer samples than the indexed chunk; source may be truncated.",
                    )
                reference = waveform.mean(0)
                mean = reference.mean()
                scale = reference.std().clamp(min=1e-8)
                mixture = (waveform - mean) / scale
                with torch.no_grad():
                    estimates = apply_model(
                        model, mixture[None], device="cpu", split=True,
                        progress=False, num_workers=0, **profile,
                    )[0]
                if estimates.ndim != 3 or estimates.shape[0] != len(STEMS):
                    raise WorkerError("inference-failed", "Demucs returned the wrong number of sources.")

                last = chunk_index == chunk_count - 1
                for stem in STEMS:
                    source_index = model.sources.index(stem.lower())
                    estimates_stem = estimates[source_index]
                    core_tensor = estimates_stem[
                        :, window.offset_frames:window.offset_frames + window.core_frames
                    ] * scale + mean
                    if core_tensor.shape != (channels, window.core_frames):
                        raise WorkerError("inference-failed", f"Invalid core audio shape for {stem}.")
                    if not bool(torch.isfinite(core_tensor).all()):
                        raise WorkerError("inference-failed", f"Non-finite samples in {stem}.")
                    core = core_tensor.transpose(0, 1).contiguous().numpy()
                    if core.size:
                        peak[stem] = max(peak[stem], float(np.max(np.abs(core))))
                    writer = writers[stem]
                    if chunk_index:
                        previous_tail = tails[stem]
                        if len(previous_tail) != fade or len(core) < fade:
                            raise WorkerError("inference-failed", "Chunk crossfade boundary is incomplete.")
                        mix = np.linspace(0, 1, fade, endpoint=False, dtype=np.float32)[:, None]
                        crossfaded = previous_tail * (1 - mix) + core[:fade] * mix
                        writer.write(crossfaded)
                        written_frames[stem] += fade
                        core = core[fade:]
                    if not last:
                        if len(core) <= fade:
                            raise WorkerError("inference-failed", "Chunk shorter than overlap after trimming.")
                        writer.write(core[:-fade])
                        written_frames[stem] += len(core) - fade
                        tails[stem] = core[-fade:].copy()
                    else:
                        writer.write(core)
                        written_frames[stem] += len(core)
                del waveform, mixture, estimates

        if set(written_frames.values()) != {total_frames}:
            raise WorkerError(
                "inference-failed",
                f"Streaming sample count mismatch: {written_frames} vs {total_frames}.",
            )

        # The entire float output is encoded only after all chunks have been
        # verified, so a failure never publishes a misleading partial file.
        outputs: list[dict[str, str]] = []
        for index, stem in enumerate(STEMS):
            on_progress(0.9 + 0.08 * index / len(STEMS), "Encoding and verifying stems")
            gain = min(1.0, 0.999 / max(peak[stem], 1e-9))
            codec = {
                "wav": ["-c:a", "pcm_s16le"],
                "wav24": ["-c:a", "pcm_s24le"],
                "flac": ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"],
                "mp3": ["-c:a", "libmp3lame", "-b:a", "320k"],
            }[output_format]
            ffmpeg = os.environ.get("LAS_FFMPEG_PATH", "ffmpeg")
            argv = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
                "-i", str(scratch_paths[stem]), "-af", f"volume={gain:.12g}",
                *codec, str(output_paths[stem]),
            ]
            timeout = max(90, min(3600, int(input_duration * 3)))
            try:
                completed = subprocess.run(
                    argv, capture_output=True, text=True, timeout=timeout, check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise WorkerError("encoding-failed", f"Could not encode {stem}: {exc}") from exc
            if completed.returncode != 0:
                raise WorkerError("encoding-failed", f"FFmpeg could not encode {stem}: {completed.stderr[-250:]}")
            verify_audio_file(
                str(output_paths[stem]),
                expected_duration=input_duration,
                expected_sample_rate=samplerate, expected_channels=channels,
            )
            outputs.append({"stem": stem, "path": str(output_paths[stem])})
        elapsed = time.perf_counter() - started
        on_progress(1.0, f"Completed {chunk_count} chunk(s) in {elapsed:.1f}s")
        return outputs
    finally:
        for intermediate in scratch_paths.values():
            try:
                intermediate.unlink(missing_ok=True)
            except OSError:
                pass
