#!/usr/bin/env python3
"""Offline, reproducible WAV stem comparison. No network or model download.

Metrics:
  SI-SDR (dB) against optional ground-truth vocals and instrumental.
  Mixture reconstruction SNR (dB) against optional original mix.
A higher SI-SDR indicates a better match to the known reference; a higher
reconstruction SNR only measures sum consistency, NOT true separation quality.
All inputs MUST be aligned 16-bit PCM WAV files with identical audio layout.
"""
from __future__ import annotations

import argparse
from array import array
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import wave

EPS = 1e-12
CHUNK = 32768


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def layout(f: wave.Wave_read) -> tuple[int, int, int]:
    if f.getsampwidth() != 2 or f.getcomptype() != "NONE":
        raise ValueError("Benchmark requires uncompressed signed 16-bit PCM WAV files.")
    if f.getnchannels() not in (1, 2):
        raise ValueError("Benchmark supports mono or stereo WAV audio only.")
    return (f.getframerate(), f.getnchannels(), f.getnframes())


class PairStats:
    def __init__(self) -> None:
        self.n = 0
        self.a = self.b = self.aa = self.bb = self.ab = 0.0

    def push(self, reference: array, estimate: array) -> None:
        if len(reference) != len(estimate):
            raise ValueError("Reference and estimated audio sample counts differ.")
        for x, y in zip(reference, estimate):
            r, e = x / 32768.0, y / 32768.0
            self.n += 1
            self.a += r
            self.b += e
            self.aa += r * r
            self.bb += e * e
            self.ab += r * e

    def si_sdr(self) -> float | None:
        if not self.n:
            return None
        target = max(0.0, self.aa - self.a * self.a / self.n)
        est = max(0.0, self.bb - self.b * self.b / self.n)
        dot = self.ab - self.a * self.b / self.n
        if target <= EPS or est <= EPS:
            return None  # Silent reference/estimate: SI-SDR is undefined.
        projected = min(est, dot * dot / target)
        residual = max(0.0, est - projected)
        if projected <= EPS:
            return -120.0
        if residual <= EPS:
            return 120.0  # Computational cap for a near-perfect estimate.
        return round(10.0 * math.log10(projected / residual), 4)


def decode(raw: bytes) -> array:
    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def compare(
    candidate_vocals: Path, candidate_instrumental: Path,
    mix: Path | None, vocals_ref: Path | None, instrumental_ref: Path | None,
) -> dict:
    sources = {"vocals": candidate_vocals, "instrumental": candidate_instrumental}
    if mix is not None:
        sources["mixture"] = mix
    if vocals_ref is not None:
        sources["reference_vocals"] = vocals_ref
        sources["reference_instrumental"] = instrumental_ref
    with ExitWaves(sources) as tracks:
        shape = layout(next(iter(tracks.values())))
        for name, stream in tracks.items():
            if layout(stream) != shape:
                raise ValueError(f"Audio shape mismatch for {name}: require identical sample rate, channels, and frames.")
        vocal_stats = PairStats()
        inst_stats = PairStats()
        signal_energy = error_energy = 0.0
        while True:
            chunks = {name: decode(stream.readframes(CHUNK)) for name, stream in tracks.items()}
            length = len(chunks["vocals"])
            if length == 0:
                break
            if any(len(part) != length for part in chunks.values()):
                raise ValueError("Mismatched audio frame length in benchmark.")
            if vocals_ref is not None:
                vocal_stats.push(chunks["reference_vocals"], chunks["vocals"])
                inst_stats.push(chunks["reference_instrumental"], chunks["instrumental"])
            if mix is not None:
                for m, v, i in zip(chunks["mixture"], chunks["vocals"], chunks["instrumental"]):
                    source = m / 32768.0
                    error = source - (v + i) / 32768.0
                    signal_energy += source * source
                    error_energy += error * error
        if shape[2] == 0:
            raise ValueError("No audio frames found.")
        reconstructed = None
        if mix is not None and signal_energy > EPS:
            reconstructed = 120.0 if error_energy <= EPS else round(
                10 * math.log10(signal_energy / error_energy), 4)
        return {
            "sample_rate_hz": shape[0],
            "channels": shape[1],
            "duration_seconds": round(shape[2] / shape[0], 4),
            "ground_truth_available": vocals_ref is not None,
            "vocals_si_sdr_db": vocal_stats.si_sdr() if vocals_ref is not None else None,
            "instrumental_si_sdr_db": inst_stats.si_sdr() if vocals_ref is not None else None,
            "mixture_reconstruction_snr_db": reconstructed,
        }


class ExitWaves:
    def __init__(self, files: dict[str, Path]) -> None:
        self.files = files
        self.opened: dict[str, wave.Wave_read] = {}

    def __enter__(self) -> dict[str, wave.Wave_read]:
        try:
            for name, file in self.files.items():
                self.opened[name] = wave.open(str(file), "rb")
            return self.opened
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, _kind, _error, _trace) -> None:
        for stream in self.opened.values():
            stream.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mixture", type=Path, help="Original mixture WAV; measures sum/reconstruction only.")
    parser.add_argument("--reference-vocals", type=Path, help="Known ground-truth vocals WAV.")
    parser.add_argument("--reference-instrumental", type=Path, help="Known ground-truth instrumental WAV.")
    parser.add_argument("--candidate", nargs=3, action="append", required=True,
                        metavar=("NAME", "VOCALS_WAV", "INSTRUMENTAL_WAV"),
                        help="One or more model output pairs; compare the same source and lengths.")
    parser.add_argument("--output", type=Path, help="Write complete benchmark JSON here.")
    args = parser.parse_args(argv)
    if (args.reference_vocals is None) != (args.reference_instrumental is None):
        parser.error("Both ground-truth files are required to calculate SI-SDR.")
    if not args.mixture and not args.reference_vocals:
        parser.error("Provide a mixture or both ground-truth stems for meaningful metrics.")
    candidates = {}
    provenance = {}
    try:
        for name, voc, inst in args.candidate:
            if name in candidates:
                raise ValueError("Candidate names must be unique.")
            v, i = Path(voc), Path(inst)
            metrics = compare(v, i, args.mixture, args.reference_vocals, args.reference_instrumental)
            candidates[name] = metrics
            provenance[name] = {"vocals_sha256": file_digest(v), "instrumental_sha256": file_digest(i)}
        report = {
            "schema_version": 1,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "method": "streaming_pcm16_si_sdr_and_mixture_reconstruction",
            "notes": [
                "SI-SDR requires true ground-truth stems; a missing score does not mean poor separation.",
                "Mixture reconstruction alone cannot establish vocal isolation or perceptual quality.",
                "All files must be sample-aligned. 120 dB / -120 dB are numeric caps.",
                "CPU/GPU speed and subjective listening quality must be measured separately.",
            ],
            "reference_sha256": {
                k: file_digest(v) for k, v in {
                    "mixture": args.mixture,
                    "vocals": args.reference_vocals,
                    "instrumental": args.reference_instrumental,
                }.items() if v is not None
            },
            "candidates": candidates,
            "candidate_file_sha256": provenance,
        }
        output = json.dumps(report, indent=2, allow_nan=False)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output + "\n", encoding="utf-8")
        print(output)
        return 0
    except (ValueError, OSError, EOFError, wave.Error) as error:
        print(f"Benchmark failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
