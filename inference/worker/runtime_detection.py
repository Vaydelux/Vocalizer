"""Runtime detection — probe ONNX Runtime / PyTorch / CUDA availability.
Reports only what is genuinely present; never claims a device works without
probing it.
"""

from __future__ import annotations
from typing import Any


def detect_runtimes() -> tuple[list[str], list[str]]:
    runtimes: list[str] = []
    devices: list[str] = ["cpu"]

    try:
        import onnxruntime as ort
        runtimes.append(f"onnxruntime:{ort.__version__}")
        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" in providers:
            devices.append("cuda")
        if "DmlExecutionProvider" in providers:
            devices.append("directml")
    except ImportError:
        pass

    try:
        import torch
        runtimes.append(f"torch:{torch.__version__}")
        if torch.cuda.is_available():
            if "cuda" not in devices:
                devices.append("cuda")
    except ImportError:
        pass

    return runtimes, devices
