"""Real FFmpeg check: RoFormer shared peak safety gain preserves stem balance.

Generate original signals; do not download audio or AI models. Probe actual
24-bit PCM output to detect clips and accidental independent normalization.
Usage: python scripts/smoke-roformer-levels.py --ffmpeg <ffmpeg>
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True)
    args = parser.parse_args()
    executable = str(Path(args.ffmpeg).resolve())

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
    import numpy as np
    import soundfile as sf
    from stem_export_levels import shared_pcm_export_gain

    rate = 44100
    t = np.arange(rate, dtype=np.float32) / rate
    vocal = np.stack([
        1.50 * np.sin(2 * np.pi * 440 * t),
        1.20 * np.sin(2 * np.pi * 440 * t),
    ], axis=1)
    instrumental = np.stack([
        0.25 * np.sin(2 * np.pi * 660 * t),
        0.20 * np.sin(2 * np.pi * 660 * t),
    ], axis=1)
    gain = shared_pcm_export_gain(
        [float(np.max(np.abs(vocal))), float(np.max(np.abs(instrumental)))]
    )
    expected = (vocal * gain, instrumental * gain)

    with TemporaryDirectory(prefix="vocalizer-stem-levels-") as folder:
        outputs = []
        for index, data in enumerate(expected):
            source = Path(folder) / f"{index}-intermediate.wav"
            target = Path(folder) / f"{index}-export.wav"
            sf.write(str(source), data, rate, format="WAV", subtype="FLOAT")
            command = [
                executable, "-hide_banner", "-loglevel", "error", "-nostdin",
                "-n", "-i", str(source), "-c:a", "pcm_s24le", str(target),
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                raise RuntimeError("FFmpeg 24-bit encode failed: " + result.stderr[-500:])
            decoded, sample_rate = sf.read(str(target), always_2d=True, dtype="float32")
            if sample_rate != rate or decoded.shape != data.shape:
                raise AssertionError("RoFormer export sample-rate/channel/length mismatch.")
            if float(np.max(np.abs(decoded))) > 1.0:
                raise AssertionError("RoFormer output exceeded PCM clip ceiling.")
            if not np.allclose(decoded, data, atol=2e-6):
                raise AssertionError("RoFormer output did not preserve common-gain samples.")
            outputs.append(decoded)

        # Critical bug regression: a quiet instrumental must not be boosted
        # relative to the vocal when a loud vocal needs common attenuation.
        actual_ratio = float(np.max(np.abs(outputs[0]))) / float(np.max(np.abs(outputs[1])))
        original_ratio = float(np.max(np.abs(vocal))) / float(np.max(np.abs(instrumental)))
        if abs(actual_ratio / original_ratio - 1.0) > 0.005:
            raise AssertionError("Encoded stems lost their original relative peak balance.")
        print(f"Verified 24-bit PCM shared-gain stem balance (gain={gain:.6f}, ratio={actual_ratio:.4f}).")


if __name__ == "__main__":
    main()
