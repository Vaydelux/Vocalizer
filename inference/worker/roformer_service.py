"""Local CPU RoFormer inference from paired safetensors + MSST YAML.

No torch.load/pickle, network access, checkpoint download or arbitrary Python
config evaluation. Every output is actual model inference plus PCM/FFmpeg
encoding; an incompatible checkpoint fails with a typed error, not fake stems.

Preview limits: stereo/mono CPU, 30-second input, overlap-add windows, no GPU.
"""
from __future__ import annotations

import inspect
import math
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from audio_encoding_options import stem_codec_args
from audio_validation import probe, verify_audio_file
from errors import WorkerError
from roformer_model import RoformerProfile, read_roformer_profile

MAX_INPUT_SECONDS = 30.0
MAX_INPUT_BYTES = 256 * 1024 * 1024
# Known MSST training-only or inactive settings must never alter inference.
IGNORABLE_DEFAULTS = {
    "use_torch_checkpoint": False,
    "skip_connection": False,
    # MSST config contains a disabled linear transformer even in BS models.
    # Ignoring zero is equivalent to omitting that optional block.
    "linear_transformer_depth": 0,
    # Upstream MaskEstimator defaults to 4; only this identical value is safe
    # to ignore when the constructor lacks an explicit expansion option.
    "mlp_expansion_factor": 4,
}

def roformer_backend(profile: RoformerProfile) -> str:
    """Select the architecture implementation from model semantics, not path.

    MSST checkpoints use a distinct MaskEstimator topology and sometimes an
    extra linear transformer module. Ignoring these options would make strict
    tensor loading fail. Do not retry with loose loading or silent weight
    remapping.
    """
    # The existing user model collection consists of MSST-exported weights,
    # so select the MSST topology by default. The newer upstream architecture
    # added residual streams and gated attention, and therefore must be chosen
    # only when those explicit architecture options appear in the YAML.
    upstream_markers = {
        "num_residual_streams", "num_residual_fracs",
        "mc_hyper_conn_sinkhorn_iters", "use_gated_xsa",
        "add_value_residual", "linear_flash_attn",
    }
    if upstream_markers.intersection(profile.model_kwargs):
        return "upstream"
    return "msst"


def model_init_kwargs(profile: RoformerProfile, model_class) -> dict:
    """Fail closed when required YAML parameters are absent from the loader."""
    accepted = set(inspect.signature(model_class.__init__).parameters) - {"self"}
    unsupported = {
        key: value for key, value in profile.model_kwargs.items()
        if key not in accepted and IGNORABLE_DEFAULTS.get(key, object()) != value
    }
    if unsupported:
        keys = ", ".join(sorted(unsupported))
        raise WorkerError(
            "architecture-unsupported",
            f"This checkpoint needs an incompatible RoFormer implementation ({keys}); "
            "model weights were not loaded and nothing was exported.",
        )
    params = {key: value for key, value in profile.model_kwargs.items() if key in accepted}

    # YAML sequences are normally parsed as lists; both MSST and upstream
    # model constructors declare these frequency settings as integer tuples
    # and validate their runtime types with beartype. Convert only known
    # tuple-valued configuration keys, preserving all actual dimensions.
    for key in ("freqs_per_bands", "multi_stft_resolutions_window_sizes"):
        if key not in params:
            continue
        value = params[key]
        if not isinstance(value, (list, tuple)) or not 1 <= len(value) <= 8192 or any(
            type(item) is not int or not 1 <= item <= 131072 for item in value
        ):
            raise WorkerError(
                "model-corrupted", f"RoFormer {key} must be a nonempty sequence of positive integer frequencies."
            )
        if key == "freqs_per_bands" and len(value) < 2:
            raise WorkerError("model-corrupted", "BS-RoFormer needs at least two frequency bands.")
        params[key] = tuple(value)
    # Modern upstream builds default to multistream hyperconnections, unlike
    # older MSST checkpoints. A strict safetensors load below will still reject
    # any actual parameter-shape mismatch instead of silently adapting weights.
    if "num_residual_streams" in accepted and "num_residual_streams" not in params:
        params["num_residual_streams"] = 1
    # Some configs place sample_rate under audio only. MelBand filters depend
    # on this value, so it must never silently use a mismatched 44100 default.
    if "sample_rate" in accepted:
        params.setdefault("sample_rate", profile.sample_rate)
    if params.get("flash_attn") is True:
        # No CUDA kernel is installed on the packaged CPU runtime.
        params["flash_attn"] = False
    return params


def _run_ffmpeg(argv: list[str], timeout: int = 90) -> None:
    try:
        completed = subprocess.run(argv, capture_output=True, text=True,
                                   check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorkerError("encoding-failed", f"FFmpeg operation failed: {exc}") from exc
    if completed.returncode != 0:
        raise WorkerError("encoding-failed", f"FFmpeg failed: {completed.stderr[-350:]}")


def _decode_source(input_path: str, profile: RoformerProfile, duration: float):
    import numpy as np
    executable = os.environ.get("LAS_FFMPEG_PATH", "ffmpeg")
    args = [executable, "-hide_banner", "-loglevel", "error", "-nostdin",
            "-i", input_path, "-map", "0:a:0",
            # Bound output at the decoder, not after capture_output has already
            # accumulated potentially unbounded media bytes in process memory.
            "-t", str(MAX_INPUT_SECONDS + 0.1), "-vn",
            "-ar", str(profile.sample_rate), "-ac", str(profile.channels),
            "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"]
    max_frames = math.ceil(MAX_INPUT_SECONDS * profile.sample_rate)
    try:
        proc = subprocess.run(args, capture_output=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorkerError("inference-failed", f"Cannot decode input: {exc}") from exc
    if proc.returncode != 0:
        raise WorkerError("inference-failed", "FFmpeg cannot decode the selected audio.")
    if len(proc.stdout) > max_frames * profile.channels * 4 + profile.channels * 4096:
        raise WorkerError("out-of-memory", "Decoded audio exceeds the 30-second preview safety cap.")
    decoded = np.frombuffer(proc.stdout, dtype="<f4")
    if not decoded.size or decoded.size % profile.channels:
        raise WorkerError("inference-failed", "FFmpeg produced an invalid PCM buffer.")
    frames = decoded.size // profile.channels
    if frames > max_frames or abs(frames / profile.sample_rate - duration) > 0.4:
        raise WorkerError("inference-failed", "Source duration changed during decoding.")
    return decoded.reshape(frames, profile.channels).T.copy()


def _model_outputs(model, mixture, profile: RoformerProfile):
    import torch
    import numpy as np

    with torch.inference_mode():
        result = model(torch.from_numpy(mixture[None, :, :]))
    if not isinstance(result, torch.Tensor):
        raise WorkerError("inference-failed", "RoFormer returned an unsupported output structure.")
    result = result.detach().cpu().float().numpy()
    if len(profile.stems) == 2:
        # Models trained with one target output a (batch, channels, frames)
        # tensor and require subtraction to obtain the complementary signal.
        # True two-output models carry a separate stem axis and must never
        # be reduced to a fabricated difference track.
        stems_count = profile.model_kwargs.get("num_stems", 1)
        if stems_count == 2:
            if result.ndim != 4 or result.shape[:3] != (1, 2, profile.channels):
                raise WorkerError("inference-failed", f"Expected explicit two-stem RoFormer output, got {result.shape}.")
            names = {"vocals": "Vocals", "instrumental": "Instrumental", "other": "Instrumental"}
            return {names[name]: result[0, index]
                    for index, name in enumerate(profile.instruments)}
        # MSST BS-RoFormer returns [batch, 1, channels, frames] even for a
        # single target, whereas MSST MelBand returns [batch, channels, frames].
        if result.ndim == 4 and result.shape[:3] == (1, 1, profile.channels):
            target = result[0, 0]
        elif result.ndim == 3 and result.shape[:2] == (1, profile.channels):
            target = result[0]
        else:
            raise WorkerError("inference-failed", f"Unexpected single-target RoFormer tensor shape: {result.shape}.")
        if profile.target == "vocals":
            return {"Vocals": target, "Instrumental": mixture - target}
        if profile.target == "instrumental":
            return {"Vocals": mixture - target, "Instrumental": target}
        raise WorkerError("architecture-unsupported", "Model target is not a verified vocal/instrumental stem.")
    if result.ndim != 4 or result.shape[:3] != (1, 4, profile.channels):
        raise WorkerError("inference-failed", f"Unexpected multistem RoFormer tensor shape: {result.shape}.")
    labels = {"vocals": "Vocals", "drums": "Drums", "bass": "Bass", "other": "Other"}
    return {labels[name]: result[0, index] for index, name in enumerate(profile.instruments)}


def _render_windows(model, source, profile: RoformerProfile, on_progress):
    import numpy as np
    frames = source.shape[-1]
    chunk = profile.chunk_frames
    step = max(1, chunk // profile.overlap)
    starts = list(range(0, max(1, frames - chunk + 1), step))
    if not starts or starts[-1] + chunk < frames:
        starts.append(max(0, frames - chunk))
    starts = sorted(set(starts))
    output = {stem: np.zeros_like(source, dtype=np.float32) for stem in profile.stems}
    weight_sum = np.zeros(frames, dtype=np.float32)

    for index, start in enumerate(starts):
        end = min(start + chunk, frames)
        window = np.zeros((profile.channels, chunk), dtype=np.float32)
        window[:, :end-start] = source[:, start:end]
        predicted = _model_outputs(model, window, profile)
        length = end - start
        taper = np.ones(length, dtype=np.float32)
        if index > 0:
            left_overlap = max(0, starts[index - 1] + chunk - start)
            fade = min(length, left_overlap)
            if fade > 0: taper[:fade] = np.linspace(1.0/max(2,fade), 1.0, fade)
        if index < len(starts) - 1:
            right_overlap = max(0, end - starts[index + 1])
            fade = min(length, right_overlap)
            if fade > 0:
                ramp = np.linspace(1.0, 1.0/max(2,fade), fade)
                taper[-fade:] = np.minimum(taper[-fade:], ramp)
        for stem in profile.stems:
            audio = predicted[stem]
            if audio.shape != window.shape or not np.all(np.isfinite(audio)):
                raise WorkerError("inference-failed", f"{stem} produced invalid model audio.")
            output[stem][:, start:end] += audio[:, :length] * taper
        weight_sum[start:end] += taper
        on_progress(0.05 + 0.80 * (index + 1) / len(starts), f"RoFormer window {index+1}/{len(starts)}")

    if np.any(weight_sum <= 0):
        raise WorkerError("inference-failed", "RoFormer left uncovered audio samples.")
    for audio in output.values():
        audio /= weight_sum[None, :]
    return output


def separate_roformer(
    model_id: str, model_path: str, config_path: str | None,
    architecture: str, input_path: str, output_dir: str,
    requested_stems: list[str], output_format: str, device: str,
    profile_name: str, on_progress, mp3_bitrate: int = 320,
) -> tuple[list[dict[str, str]], str, str, bool]:
    if device not in ("cpu", "auto"):
        raise WorkerError("device-unsupported", "RoFormer preview supports local CPU only.")
    if not config_path:
        raise WorkerError("model-not-found", "Select paired config.yaml for this safetensors checkpoint.")
    if model_id != "model.safetensors":
        raise WorkerError("model-not-found", "Select a local model.safetensors checkpoint.")
    if output_format not in ("wav", "wav24", "mp3", "flac"):
        raise WorkerError("encoding-failed", "Unsupported RoFormer audio output format.")
    profile = read_roformer_profile(model_path, config_path, architecture, requested_stems)
    source = Path(input_path)
    if not source.is_file() or source.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerError("inference-failed", "Select an accessible audio file under 256 MiB.")
    meta = probe(input_path)
    duration = float(meta.get("format", {}).get("duration") or "0")
    if not math.isfinite(duration) or not 0 < duration <= MAX_INPUT_SECONDS:
        raise WorkerError("inference-failed", "Local CPU RoFormer preview currently supports audio up to 30 seconds.")
    if profile_name not in ("low-memory", "balanced", "thorough"):
        raise WorkerError("inference-failed", "Unknown RoFormer processing profile.")

    try:
        import torch
        import numpy as np
        import soundfile as sf
        from safetensors.torch import load_file
        from bs_roformer import BSRoformer as UpstreamBSRoformer, MelBandRoformer as UpstreamMelBandRoformer
        from msst_roformer import BSRoformer as MSSTBSRoformer, MelBandRoformer as MSSTMelBandRoformer
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "RoFormer CPU inference dependencies are not bundled.") from exc

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    backend = roformer_backend(profile)
    if backend == "msst":
        cls = MSSTBSRoformer if architecture == "bs-roformer" else MSSTMelBandRoformer
    else:
        cls = UpstreamBSRoformer if architecture == "bs-roformer" else UpstreamMelBandRoformer
    on_progress(None, f"Validating local {backend.upper()} RoFormer architecture")
    params = model_init_kwargs(profile, cls)
    on_progress(None, f"Loading {backend} RoFormer safetensors")
    try:
        model = cls(**params)
        state = load_file(model_path, device="cpu")
        model.load_state_dict(state, strict=True)
        del state
        model.eval().cpu()
    except (RuntimeError, ValueError, TypeError, AssertionError, KeyError) as exc:
        raise WorkerError("architecture-unsupported",
                          f"RoFormer checkpoint does not strictly match this installed architecture: {str(exc)[:300]}") from exc

    audio = _decode_source(input_path, profile, duration)
    on_progress(None, "Running local RoFormer CPU inference")
    outputs = _render_windows(model, audio, profile, on_progress)
    del model
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    suffix = "wav" if output_format in ("wav", "wav24") else output_format
    paths = {stem: destination / f"roformer_({stem}).{suffix}" for stem in profile.stems}
    if any(path.exists() for path in paths.values()):
        raise WorkerError("encoding-failed", "RoFormer destination already contains a stem output.")
    emitted: list[dict[str, str]] = []
    with TemporaryDirectory(prefix="vocalizer-roformer-") as staging:
        try:
            for index, stem in enumerate(profile.stems):
                on_progress(0.85 + 0.14 * index / len(profile.stems), "Encoding and verifying RoFormer stems")
                intermediate = Path(staging) / f"{index}.wav"
                float_audio = outputs[stem]
                peak = max(1.0, float(np.max(np.abs(float_audio))) / 0.999)
                sf.write(str(intermediate), (float_audio / peak).T,
                         profile.sample_rate, format="WAV", subtype="FLOAT")
                argv = [
                    os.environ.get("LAS_FFMPEG_PATH", "ffmpeg"), "-hide_banner",
                    "-loglevel", "error", "-nostdin", "-n", "-i", str(intermediate),
                    *stem_codec_args(output_format, mp3_bitrate), str(paths[stem]),
                ]
                _run_ffmpeg(argv, timeout=180)
                verify_audio_file(str(paths[stem]), expected_duration=audio.shape[-1] / profile.sample_rate,
                                  expected_sample_rate=profile.sample_rate, expected_channels=profile.channels)
                emitted.append({"stem": stem, "path": str(paths[stem])})
        except Exception:
            for path in paths.values():
                try: path.unlink(missing_ok=True)
                except OSError: pass
            raise
    on_progress(1.0, "RoFormer separation complete")
    return emitted, model_id, "cpu", False
