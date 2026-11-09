"""Real FFmpeg MP3 stem-codec smoke without requiring a model checkpoint.

Uses the same validated Python codec argument function as HTDemucs, and
FFprobe verifies the resulting CBR stream bitrate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference" / "worker"))

from audio_encoding_options import stem_codec_args


def run(binary: str, args: list[str]) -> str:
    result = subprocess.run([binary, *args], capture_output=True, text=True,
                            timeout=60, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"{binary} failed: {result.stderr[-600:]}")
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="vocalizer-stem-rate-") as directory:
        source = Path(directory) / "source.wav"
        run(args.ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
            "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=44100:duration=2",
            "-ac", "2", "-c:a", "pcm_s16le", str(source),
        ])
        for bitrate in (128, 320):
            output = Path(directory) / f"stem-{bitrate}.mp3"
            run(args.ffmpeg, [
                "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
                "-i", str(source), *stem_codec_args("mp3", bitrate), str(output),
            ])
            metadata = json.loads(run(args.ffprobe, [
                "-v", "error", "-show_entries",
                "stream=codec_name,bit_rate:format=duration",
                "-of", "json", str(output),
            ]))
            stream = next((entry for entry in metadata.get("streams", [])
                           if entry.get("codec_name") == "mp3"), None)
            actual = int(stream["bit_rate"]) if stream and stream.get("bit_rate") else 0
            duration = float(metadata.get("format", {}).get("duration", 0))
            expected = bitrate * 1000
            if abs(actual - expected) > expected * 0.08 or not (1.95 <= duration <= 2.15):
                raise AssertionError(f"Incorrect encoded stem MP3: requested={expected} actual={actual} duration={duration}")
            print(f"Verified MP3 stem codec {bitrate} kbps: {actual} bps")


if __name__ == "__main__":
    main()
