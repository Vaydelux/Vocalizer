"""Windows acceptance for genuine packaged HTDemucs streaming inference.

Runs both a short single-window input and a longer two-window source in the
Low Memory profile. Checkpoint is supplied by CI, never shipped in the ZIP.
The synthetic sine tests audio integrity and continuity, not source quality.
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

STEMS = {"Vocals", "Drums", "Bass", "Other"}


def run(argv: list[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(argv, check=True, text=True, capture_output=True, timeout=timeout)


def check_duration(args, duration: int, env: dict[str, str]) -> float:
    with tempfile.TemporaryDirectory(prefix="vocalizer-demucs-stream-test-") as directory:
        work = Path(directory)
        source = work / "synthetic.wav"
        output = work / "results"
        output.mkdir()
        # Deterministic stereo PCM. Long version crosses the eight-second
        # Low Memory core boundary and exercises the exact crossfade path.
        run([
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
            "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(source),
        ], 45)
        request_id = f"acceptance-{duration}"
        job_file = work / "job.json"
        job_file.write_text(json.dumps({
            "type": "separate", "requestId": request_id,
            "modelId": "955717e8-8726e21a.th",
            "modelPath": str(Path(args.model).resolve()),
            "architecture": "demucs",
            "inputPath": str(source),
            "outputDir": str(output),
            "requestedStems": sorted(STEMS),
            "outputFormat": "wav24",
            "device": "cpu",
            "profile": "low-memory",
        }), encoding="utf-8")

        started = time.perf_counter()
        proc = subprocess.run(
            [args.exe, "--job", str(job_file)], env=env, capture_output=True,
            text=True, timeout=600,
        )
        elapsed = time.perf_counter() - started
        messages = []
        for line in proc.stdout.splitlines():
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise AssertionError(f"Unexpected worker protocol output: {line[:250]}") from exc
        errors = [m for m in messages if m.get("type") == "error"]
        if proc.returncode or errors:
            raise AssertionError(
                f"Packaged {duration}s inference failed (exit={proc.returncode}): "
                f"{errors}, stderr: {proc.stderr[-3500:]}"
            )
        results = [m for m in messages if m.get("type") == "result"]
        assert len(results) == 1, f"Expected one completed job: {messages[-4:]}"
        result = results[0]
        assert result["requestId"] == request_id
        assert result["deviceUsed"] == "cpu"
        stems = result["stems"]
        assert len(stems) == 4 and {s["stem"] for s in stems} == STEMS, stems

        lengths = []
        for item in stems:
            file = Path(item["path"])
            assert file.is_file() and file.stat().st_size > 1024, file
            metadata = json.loads(run([
                args.ffprobe, "-v", "error", "-show_streams",
                "-show_format", "-print_format", "json", str(file),
            ], 30).stdout)
            audio = [stream for stream in metadata.get("streams", [])
                     if stream.get("codec_type") == "audio"]
            assert len(audio) == 1, file
            assert int(audio[0].get("sample_rate", "0")) == 44100, file
            assert int(audio[0].get("channels", "0")) == 2, file
            assert audio[0].get("codec_name") == "pcm_s24le", (file, audio[0])
            measured = float(metadata["format"]["duration"])
            assert math.isfinite(measured) and abs(measured - duration) <= 0.025, (
                file, measured, duration,
            )
            lengths.append(measured)
        assert max(lengths) - min(lengths) <= .005, lengths
        # If overlap frames are duplicated, the 9-second output becomes >9s.
        # If they are dropped, it becomes shorter. This guards both errors.
        print(f"PASS: packaged HTDemucs CPU generated four {duration}s, "
              f"stereo, 24-bit, FFprobe-verified stems ({elapsed:.1f}s wall time)")
        return elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    args = parser.parse_args()
    env = dict(os.environ, LAS_FFPROBE_PATH=str(Path(args.ffprobe).resolve()),
               LAS_FFMPEG_PATH=str(Path(args.ffmpeg).resolve()))
    env["PATH"] = str(Path(args.ffmpeg).resolve().parent) + os.pathsep + env.get("PATH", "")
    measurements = {str(duration): check_duration(args, duration, env) for duration in (3, 9)}
    print("PASS: genuine packaged one- and two-window inference and stem export")
    print("BENCHMARK_WALL_SECONDS " + json.dumps(measurements, sort_keys=True))
    print("NOTE: test tone does not establish perceptual quality or SDR.")


if __name__ == "__main__":
    main()
