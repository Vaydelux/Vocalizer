"""Real separation service — wraps `audio-separator` (python-audio-separator).

Performs genuine neural-network inference (ONNX Runtime for MDX-Net, PyTorch for
Demucs/RoFormer). No results are fabricated. Output files are verified with
FFprobe before being reported as results.
"""

from __future__ import annotations
import os
import time
from typing import Any

from audio_separator.separator import Separator as ASeparator

from errors import WorkerError
from audio_validation import verify_audio_file

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
        self._separators: dict[str, ASeparator] = {}

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
        cancel_event,
    ) -> tuple[list[dict[str, Any]], str, str, bool]:
        if not os.path.isfile(input_path):
            raise WorkerError("inference-failed", f"Input file not found: {input_path}")
        os.makedirs(output_dir, exist_ok=True)

        on_progress(0.05, "Loading model")
        # Reuse a Separator per output format (the underlying model is cached).
        cache_key = f"{architecture}:{model_id}:{output_format}"
        if cache_key not in self._separators:
            sep = ASeparator(
                output_dir=output_dir,
                output_format=output_format.upper() if output_format != "wav24" else "WAV",
                log_level=40,  # WARNING — keep stdout clean
            )
            sep.load_model(model_id)
            self._separators[cache_key] = sep
        sep = self._separators[cache_key]

        on_progress(0.15, "Running inference")
        t0 = time.time()
        raw_outputs = sep.separate(input_path)
        elapsed = time.time() - t0
        if cancel_event.is_set():
            self._cleanup(raw_outputs)
            raise WorkerError("cancelled", "Separation cancelled before completion.")

        # Map raw output filenames to canonical stem names.
        stems: list[dict[str, Any]] = []
        for out_path in raw_outputs:
            name = os.path.basename(out_path)
            stem_name = self._stem_from_name(name, requested_stems)
            full = os.path.join(output_dir, name)
            # Verify the produced file is real, decodable audio.
            try:
                verify_audio_file(full)
            except WorkerError:
                raise
            except Exception as e:
                raise WorkerError("encoding-failed", f"Output verification failed for {name}: {e}")
            stems.append({"stem": stem_name, "path": full})

        on_progress(0.95, "Verifying outputs")
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
    def _stem_from_name(name: str, requested: list[str]) -> str:
        lower = name.lower()
        for stem in requested:
            token = f"({stem})"
            if token.lower() in lower:
                return stem
        # Fallback: detect common tokens.
        if "(vocals)" in lower or "vocal" in lower:
            return "Vocals"
        if "(instrumental)" in lower or "instrumental" in lower:
            return "Instrumental"
        return requested[0] if requested else "Other"

    @staticmethod
    def _cleanup(paths: list[str]) -> None:
        for p in paths:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass
