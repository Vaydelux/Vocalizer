"""Real separation service — wraps `audio-separator` (python-audio-separator).

Performs genuine neural-network inference (ONNX Runtime for MDX-Net, PyTorch for
Demucs/RoFormer). No results are fabricated. Output files are verified with
FFprobe before being reported as results.
"""

from __future__ import annotations
import os
import time
from typing import Any

from errors import WorkerError
from audio_validation import verify_audio_file
from local_model import require_local_mdx_model
from inference_profiles import resolve_profile
from stem_mapping import match_stems
from audio_encoding_options import require_mp3_bitrate

# Map a requested stem name to the audio-separator output-token convention.
# MDX-Net Inst-HQ produces two files named "<input>_(Vocals)_..." and
# "<input>_(Instrumental)_..." — these map to the canonical stem names.
STEM_TOKEN_MAP = {
    "Vocals": "Vocals",
    "Instrumental": "Instrumental",
    "Drums": "Drums",
    "Bass": "Bass",
    "Other": "Other",
    "Guitar": "Guitar",
    "Piano": "Piano",
}


class SeparatorService:
    def __init__(self) -> None:
        self._separators: dict[str, Any] = {}

    def separate(
        self,
        model_id: str,
        model_path: str,
        architecture: str,
        config_path: str | None,
        input_path: str,
        output_dir: str,
        requested_stems: list[str],
        output_format: str,
        device: str,
        on_progress,
        segment_size: int | None = None,
        profile: str = "balanced",
        mp3_bitrate: int = 320,
    ) -> tuple[list[dict[str, Any]], str, str, bool]:
        mp3_bitrate = require_mp3_bitrate(mp3_bitrate)
        if not os.path.isfile(input_path):
            raise WorkerError("inference-failed", f"Input file not found: {input_path}")
        if architecture == "demucs":
            if segment_size is not None or config_path is not None:
                raise WorkerError("architecture-unsupported", "Demucs uses validated local CPU profiles.")
            from demucs_service import separate_demucs
            return separate_demucs(model_id, model_path, input_path, output_dir,
                                   requested_stems, output_format, device, profile, on_progress,
                                   mp3_bitrate=mp3_bitrate)
        if architecture != "mdx-net":
            raise WorkerError("architecture-unsupported", "This model architecture is not integrated.")
        if device not in ("cpu", "auto"):
            raise WorkerError("device-unsupported", "This inference worker is CPU-only.")
        # The audio-separator library normally downloads missing checkpoints.
        # Never start the library until we verify an actual local checkpoint.
        verified_model = require_local_mdx_model(model_id, model_path)
        # Import MDX-only dependencies lazily so HTDemucs jobs do not need
        # the legacy UVR stack, and a missing optional module cannot prevent
        # the whole worker process from reporting typed errors.
        try:
            from audio_separator.separator import Separator as ASeparator
        except ImportError as exc:
            raise WorkerError("architecture-unsupported", "MDX-Net CPU runtime dependency is missing.") from exc
        preset = resolve_profile(profile, segment_size)
        os.makedirs(output_dir, exist_ok=True)

        on_progress(None, "Preparing")
        # Reuse a Separator per output format (the underlying model is cached).
        cache_key = ":".join((architecture, str(verified_model), output_dir, output_format, str(preset["segment_size"]), str(preset["overlap"]),
                              str(mp3_bitrate) if output_format == "mp3" else "lossless"))
        if cache_key not in self._separators:
            sep = ASeparator(
                model_file_dir=str(verified_model.parent),
                output_dir=output_dir,
                output_format=output_format.upper() if output_format != "wav24" else "WAV",
                output_bitrate=f"{mp3_bitrate}k" if output_format == "mp3" else None,
                log_level=40,  # WARNING — keep stdout clean
                mdx_params={
                    "hop_length": 1024,
                    "segment_size": preset["segment_size"],
                    "overlap": preset["overlap"],
                    "batch_size": 1,
                    "enable_denoise": False,
                },
            )
            sep.load_model(verified_model.name)
            self._separators[cache_key] = sep
        sep = self._separators[cache_key]

        on_progress(None, "Loading model")
        # Indeterminate: audio-separator does not expose structured chunk/segment
        # progress, so a guessed fraction would be fabricated. The Electron UI
        # shows an indeterminate indicator for this stage.
        on_progress(None, "Running inference")
        t0 = time.time()
        raw_outputs = sep.separate(input_path)
        elapsed = time.time() - t0
        _ = elapsed  # recorded for job metadata by the caller via logs

        # Measured: verify each produced file, reporting the real fraction i/n.
        # Classify all outputs before reporting success. A count of two is
        # insufficient if both files are labeled Vocals or one is ambiguous.
        stem_names = match_stems(raw_outputs, requested_stems)
        stems: list[dict[str, Any]] = []
        total = len(raw_outputs)
        for idx, (out_path, stem_name) in enumerate(zip(raw_outputs, stem_names)):
            name = os.path.basename(out_path)
            full = os.path.join(output_dir, name)
            on_progress(idx / total, "Verifying outputs")
            try:
                verify_audio_file(full)
            except WorkerError:
                raise
            except Exception as e:
                raise WorkerError("encoding-failed", f"Output verification failed for {name}: {e}")
            stems.append({"stem": stem_name, "path": full})

        if len(stems) != len(requested_stems):
            # If the model produced a different stem count than requested, surface it
            # honestly rather than fabricating the missing stems.
            raise WorkerError(
                "inference-failed",
                f"Model produced {len(stems)} stem(s); {len(requested_stems)} requested. No substitution performed.",
            )

        on_progress(1.0, "Completed")
        return stems, model_id, "cpu", False

    @staticmethod
    def _cleanup(paths: list[str]) -> None:
        for p in paths:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass
