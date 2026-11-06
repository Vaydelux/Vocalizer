"""Windows packaged-worker acceptance test with a separately supplied checkpoint.

No test model files are bundled in the release artifact. This runs actual
Demucs CPU inference on synthetic audio and checks four probed outputs.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

EXPECTED = {"Vocals", "Drums", "Bass", "Other"}


def run(argv, timeout):
    return subprocess.run(argv, check=True, text=True, capture_output=True, timeout=timeout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    args = parser.parse_args()
    work = Path(tempfile.mkdtemp(prefix="vocalizer-demucs-acceptance-"))
    track = work / "synthetic.wav"
    out = work / "stems"
    out.mkdir()
    run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(track)], 45)

    job = {
        "type": "separate", "requestId": "acceptance1",
        "modelId": "955717e8-8726e21a.th", "modelPath": str(Path(args.model).resolve()),
        "architecture": "demucs", "inputPath": str(track),
        "outputDir": str(out), "requestedStems": sorted(EXPECTED),
        "outputFormat": "wav24", "device": "cpu", "profile": "low-memory"
    }
    job_path = work / "job.json"
    job_path.write_text(json.dumps(job), encoding="utf-8")
    env = dict(os.environ, LAS_FFPROBE_PATH=str(Path(args.ffprobe).resolve()))
    finished = subprocess.run(
        [args.exe, "--job", str(job_path)], env=env,
        capture_output=True, text=True, timeout=420,
    )
    messages = []
    for line in finished.stdout.splitlines():
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise AssertionError("Worker wrote non-JSON protocol output") from exc
    failures = [m for m in messages if m.get("type") == "error"]
    if finished.returncode or failures:
        raise AssertionError(
            f"Packaged model inference failed (exit={finished.returncode}): "
            f"{failures}, stderr: {finished.stderr[-2500:]}"
        )
    results = [m for m in messages if m.get("type") == "result"]
    assert len(results) == 1, f"Expected one real result: {messages}"
    stems = results[0]["stems"]
    assert len(stems) == 4 and {s["stem"] for s in stems} == EXPECTED, stems
    assert results[0]["deviceUsed"] == "cpu"
    durations = []
    for item in stems:
        file = Path(item["path"])
        assert file.is_file() and file.stat().st_size > 1024, file
        info = json.loads(run([args.ffprobe, "-v", "error", "-show_streams",
                               "-show_format", "-print_format", "json", str(file)], 30).stdout)
        audios = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
        assert len(audios) >= 1, file
        assert int(audios[0].get("sample_rate", "0")) == 44100, file
        duration = float(info["format"]["duration"])
        assert 2.0 <= duration <= 4.0, (file, duration)
        durations.append(duration)
    assert max(durations) - min(durations) <= 0.25, durations
    print("PASS: actual packaged HTDemucs CPU inference produced four FFprobe-verified stems")
    print("NOTE: synthetic fixture does not establish separation quality or listening score.")


if __name__ == "__main__":
    main()
