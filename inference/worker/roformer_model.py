"""Safe discovery and schema validation for user-owned RoFormer checkpoint pairs.

No checkpoint is deserialized here. YAML is parsed with SafeLoader, with only
the inert !!python/tuple sequence tag added for MSST configurations.
Unsupported configurations fail closed; file/folder names never determine the
model's architecture or stem labels.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import struct

from errors import WorkerError

MAX_CONFIG_BYTES = 512 * 1024
MAX_WEIGHTS_BYTES = 6 * 1024 * 1024 * 1024
MAX_TENSOR_HEADER_BYTES = 16 * 1024 * 1024

@dataclass(frozen=True)
class RoformerProfile:
    architecture: str
    sample_rate: int
    channels: int
    chunk_frames: int
    overlap: int
    instruments: tuple[str, ...]
    model_kwargs: dict
    target: str | None

    @property
    def stems(self) -> tuple[str, ...]:
        if len(self.instruments) == 4:
            return ("Vocals", "Drums", "Bass", "Other")
        return ("Vocals", "Instrumental")


def _read_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise WorkerError("architecture-unsupported", "PyYAML is not bundled in this worker.") from exc

    class SafeTupleLoader(yaml.SafeLoader):
        pass

    def inert_tuple(loader, node):
        return tuple(loader.construct_sequence(node, deep=True))

    SafeTupleLoader.add_constructor("tag:yaml.org,2002:python/tuple", inert_tuple)
    try:
        stat = path.lstat()
        if not path.is_file() or path.is_symlink() or not 0 < stat.st_size <= MAX_CONFIG_BYTES:
            raise ValueError("Configuration must be a regular YAML file under 512 KiB.")
        with path.open("r", encoding="utf-8") as stream:
            config = yaml.load(stream, Loader=SafeTupleLoader)
    except (OSError, ValueError, yaml.YAMLError, UnicodeError) as exc:
        raise WorkerError("model-corrupted", f"Invalid local RoFormer YAML: {exc}") from exc
    if not isinstance(config, dict):
        raise WorkerError("model-corrupted", "RoFormer YAML must contain a mapping.")
    return config


def _int_range(raw, minimum: int, maximum: int, field: str) -> int:
    if type(raw) is not int or not minimum <= raw <= maximum:
        raise WorkerError("model-corrupted", f"RoFormer config {field} must be an integer from {minimum} to {maximum}.")
    return raw


def read_roformer_profile(
    model_path: str, config_path: str, architecture: str,
    requested_stems: list[str] | None = None,
) -> RoformerProfile:
    checkpoint = Path(model_path)
    config_file = Path(config_path)
    if (not checkpoint.is_absolute() or not config_file.is_absolute()
        or checkpoint.name != "model.safetensors" or config_file.name != "config.yaml"
        or checkpoint.parent != config_file.parent):
        raise WorkerError("model-not-found", "Choose the model.safetensors and companion config.yaml in one local model folder.")
    try:
        stat = checkpoint.lstat()
        if not checkpoint.is_file() or checkpoint.is_symlink() or not 1024 <= stat.st_size <= MAX_WEIGHTS_BYTES:
            raise ValueError("Checkpoint must be a regular safetensors file between 1 KiB and 6 GiB.")
        with checkpoint.open("rb") as stream:
            header_size = struct.unpack("<Q", stream.read(8))[0]
            if not 2 <= header_size <= MAX_TENSOR_HEADER_BYTES or header_size + 8 >= stat.st_size:
                raise ValueError("Invalid safetensors header size.")
            header = json.loads(stream.read(header_size))
        if not isinstance(header, dict) or not header or not any(key != "__metadata__" for key in header):
            raise ValueError("Safetensors header has no tensors.")
    except (OSError, ValueError, KeyError, TypeError, struct.error, json.JSONDecodeError) as exc:
        raise WorkerError("model-corrupted", f"Invalid local safetensors checkpoint: {exc}") from exc

    config = _read_yaml(config_file)
    model = config.get("model")
    audio = config.get("audio")
    training = config.get("training")
    inference = config.get("inference", {})
    if not isinstance(model, dict) or not isinstance(audio, dict) or not isinstance(training, dict) or not isinstance(inference, dict):
        raise WorkerError("model-corrupted", "Config needs model, audio, training and optional inference mappings.")
    has_bands = "freqs_per_bands" in model
    has_mel = "num_bands" in model
    if has_bands == has_mel:
        raise WorkerError("model-corrupted", "RoFormer YAML must define exactly one of freqs_per_bands or num_bands.")
    detected = "bs-roformer" if has_bands else "melband-roformer"
    if architecture != detected:
        raise WorkerError("architecture-unsupported", "Selected architecture conflicts with configuration; choose the correct RoFormer family.")
    sample_rate = _int_range(audio.get("sample_rate"), 8000, 96000, "audio.sample_rate")
    channels = _int_range(audio.get("num_channels"), 1, 2, "audio.num_channels")
    chunk = _int_range(audio.get("chunk_size"), sample_rate, sample_rate * 30, "audio.chunk_size")
    overlap = _int_range(inference.get("num_overlap", 2), 1, 8, "inference.num_overlap")
    stem_count = _int_range(model.get("num_stems", 1), 1, 4, "model.num_stems")
    if model.get("stereo") != (channels == 2):
        raise WorkerError("model-corrupted", "RoFormer stereo setting disagrees with the audio channel count.")

    raw_instruments = training.get("instruments")
    if not isinstance(raw_instruments, (list, tuple)):
        raise WorkerError("model-corrupted", "RoFormer training.instruments is required.")
    instruments = tuple(str(x).strip().lower() for x in raw_instruments)
    target = training.get("target_instrument")
    if stem_count == 4 and set(instruments) == {"vocals", "drums", "bass", "other"} and len(instruments) == 4:
        if target is not None:
            raise WorkerError("architecture-unsupported", "Four-stem RoFormer must not use a single training target.")
    elif stem_count == 1 and set(instruments) in ({"vocals", "other"}, {"vocals", "instrumental"}):
        if target is None or str(target).lower() not in ("vocals", "instrumental"):
            raise WorkerError("architecture-unsupported", "Two-stem RoFormer requires a known vocals or instrumental target.")
    else:
        raise WorkerError("architecture-unsupported", "This model's denoise/dereverb/custom stems need a dedicated output contract; not mislabeled as vocals.")

    profile = RoformerProfile(detected, sample_rate, channels, chunk, overlap, instruments, dict(model), None if target is None else str(target).lower())
    if requested_stems is not None and (
        len(requested_stems) != len(profile.stems) or set(requested_stems) != set(profile.stems)
    ):
        raise WorkerError("architecture-unsupported", "Requested stems do not match the verified RoFormer YAML.")
    return profile
