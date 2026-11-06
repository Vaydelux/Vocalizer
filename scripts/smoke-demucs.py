"""Windows acceptance for genuine packaged HTDemucs streaming inference.

Runs both a short single-window input and a longer two-window source in the
Low Memory profile. Checkpoint is supplied by CI, never shipped in the ZIP.
The synthetic sine tests audio integrity and continuity, not source quality.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
import platform
from pathlib import Path
import subprocess
import tempfile
import time

from demucs_acceptance_metrics import run_monitored_worker, seam_step_metrics

STEMS = {"Vocals", "Drums", "Bass", "Other"}


def run(argv: list[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(argv, check=True, text=True, capture_output=True, timeout=timeout)


def check_duration(args, duration: int, env: dict[str, str]) -> dict:
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

        measurement = run_monitored_worker(
            [args.exe, "--job", str(job_file)], env=env, timeout_seconds=600,
        )
        messages = []
        for line in measurement["stdout"].splitlines():
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise AssertionError(f"Unexpected worker protocol output: {line[:250]}") from exc
        errors = [m for m in messages if m.get("type") == "error"]
        if measurement["returncode"] or errors:
            raise AssertionError(
                f"Packaged {duration}s inference failed (exit={measurement['returncode']}): "
                f"{errors}, stderr: {measurement['stderr'][-3500:]}"
            )
        results = [m for m in messages if m.get("type") == "result"]
        assert len(results) == 1, f"Expected one completed job: {messages[-4:]}"
        result = results[0]
        assert result["requestId"] == request_id
        assert result["deviceUsed"] == "cpu"
        stems = result["stems"]
        assert len(stems) == 4 and {s["stem"] for s in stems} == STEMS, stems

        lengths = []
        seams: dict[str, dict] = {}
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
            seams[item["stem"]] = seam_step_metrics(file, seconds=duration)
        assert max(lengths) - min(lengths) <= .005, lengths
        # Output lengths detect dropped/duplicated frames. Crossfade metrics
        # report candidate clicks but are not a substitute for listening tests.
        print(f"PASS: packaged HTDemucs CPU generated four {duration}s, "
              f"stereo, 24-bit, FFprobe-verified stems "
              f"({measurement['wall_seconds']:.1f}s wall, "
              f"{measurement['sampled_peak_worker_tree_rss_mib']:.1f} MiB sampled RSS)")
        return {
            "input_seconds": duration,
            "wall_seconds": measurement["wall_seconds"],
            "sampled_peak_worker_tree_rss_mib": measurement["sampled_peak_worker_tree_rss_mib"],
            "sampled_worker_tree_cpu_seconds": measurement["sampled_worker_tree_cpu_seconds"],
            "max_live_worker_processes": measurement["max_live_worker_processes"],
            "realtime_factor": round(measurement["wall_seconds"] / duration, 3),
            "seam_diagnostics": seams,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--metrics-output", type=Path, default=None)
    args = parser.parse_args()
    env = dict(os.environ, LAS_FFPROBE_PATH=str(Path(args.ffprobe).resolve()),
               LAS_FFMPEG_PATH=str(Path(args.ffmpeg).resolve()))
    env["PATH"] = str(Path(args.ffmpeg).resolve().parent) + os.pathsep + env.get("PATH", "")
    metrics = {
        "schema_version": 1,
        "measured_utc": datetime.now(timezone.utc).isoformat(),
        "runner_platform": platform.platform(),
        "model": "HTDemucs v4 hash-pinned CPU checkpoint",
        "profile": "low-memory",
        "note": ("Synthetic sine test measures window continuity and sample timing. "
                 "This is not an SDR, perceptual quality, 30-minute soak, or "
                 "clean-device benchmark. Sampled worker-tree RSS may count shared DLLs twice."),
        "cases": [check_duration(args, duration, env) for duration in (3, 9, 26)],
    }
    encoded = json.dumps(metrics, indent=2, allow_nan=False, sort_keys=True)
    if args.metrics_output is not None:
        args.metrics_output.parent.mkdir(parents=True, exist_ok=True)
        args.metrics_output.write_text(encoded + "\n", encoding="utf-8")
    print("PASS: genuine packaged one-, two-, and multi-window inference and stem export")
    print("BENCHMARK_CPU_AND_MEMORY " + encoded)
    print("NOTE: test tone does not establish perceptual separation quality or SDR.")


if __name__ == "__main__":
    main()
