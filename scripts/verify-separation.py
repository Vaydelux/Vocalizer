#!/usr/bin/env python3
"""
Standalone separation verifier — the command-line path that does not depend on
Electron, React, or any dev server.

Drives the inference worker's protocol end-to-end:
  init → separate → (progress) → result → FFprobe validation of each stem.

Usage:
  python scripts/verify-separation.py --input song.wav --out ./sep-out \
      [--model UVR-MDX-NET-Inst_HQ_5.onnx] [--format wav] [--stems Vocals,Instrumental]

Exits non-zero if any output fails verification. This script performs REAL
inference; it is not a mock and must not be treated as one.
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import time

WORKER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inference", "worker")


def ffprobe(path: str) -> dict:
    argv = ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-print_format", "json", path]
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"FFprobe failed for {path}: {proc.stderr[:200]}")
    return json.loads(proc.stdout)


def verify_stem(path: str, expected_duration: float) -> float:
    if not os.path.isfile(path):
        raise RuntimeError(f"Missing stem file: {path}")
    if os.path.getsize(path) == 0:
        raise RuntimeError(f"Empty stem file: {path}")
    info = ffprobe(path)
    streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise RuntimeError(f"No audio stream in {path}")
    s = streams[0]
    dur = float(s.get("duration") or info.get("format", {}).get("duration") or 0)
    if dur <= 0:
        raise RuntimeError(f"Zero duration in {path}")
    if abs(dur - expected_duration) > 0.5:
        raise RuntimeError(f"Duration mismatch in {path}: {dur:.2f}s vs input {expected_duration:.2f}s")
    sr = int(s.get("sample_rate", 0))
    ch = int(s.get("channels", 0))
    if sr < 8000 or ch < 1:
        raise RuntimeError(f"Invalid sample rate/channels in {path}: {sr}/{ch}")
    return dur


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify real two-stem separation end-to-end.")
    ap.add_argument("--input", required=True, help="Source audio file")
    ap.add_argument("--out", required=True, help="Output directory for stems")
    ap.add_argument("--model", default="UVR-MDX-NET-Inst_HQ_5.onnx")
    ap.add_argument("--format", default="wav", choices=["wav", "wav24", "mp3", "flac"])
    ap.add_argument("--stems", default="Vocals,Instrumental")
    ap.add_argument("--segment", type=int, default=256, help="MDX segment size (lower = less RAM)")
    args = ap.parse_args()

    src_info = ffprobe(args.input)
    src_streams = [s for s in src_info.get("streams", []) if s.get("codec_type") == "audio"]
    if not src_streams:
        print("Input has no audio stream", file=sys.stderr)
        return 2
    expected_duration = float(src_info.get("format", {}).get("duration") or 0)
    print(f"Input: {args.input} — {expected_duration:.2f}s")

    stems = [s.strip() for s in args.stems.split(",") if s.strip()]
    os.makedirs(args.out, exist_ok=True)
    worker = os.path.abspath(os.path.join(WORKER_DIR, "main.py"))

    separate_req = {
        "type": "separate",
        "requestId": "verify-1",
        "modelId": args.model,
        "modelPath": args.model,
        "architecture": "mdx-net",
        "inputPath": os.path.abspath(args.input),
        "outputDir": os.path.abspath(args.out),
        "requestedStems": stems,
        "outputFormat": args.format,
        "device": "cpu",
        "segmentSize": args.segment,
    }

    t0 = time.time()
    proc = subprocess.Popen(
        [sys.executable, worker],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        cwd=WORKER_DIR,
    )
    assert proc.stdin is not None and proc.stdout is not None

    def send(msg: dict) -> None:
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    result = None
    error = None
    try:
        # Interactive protocol: init → separate → read until result/error →
        # THEN shutdown. (Sending shutdown upfront would cancel the active job —
        # the worker's graceful-shutdown behavior is by design.)
        send({"type": "init", "protocolVersion": 1})
        ready = False
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ready":
                ready = True
                break
        if not ready:
            print("Worker did not become ready", file=sys.stderr)
            return 1

        send(separate_req)
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "progress":
                p = msg.get("progress")
                print(f"  [{msg.get('stage')}] {'indeterminate' if p is None else f'{p:.0%}'}")
            elif msg.get("type") == "result":
                result = msg
                break
            elif msg.get("type") == "error":
                error = msg
                break

        send({"type": "shutdown"})
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        if proc.poll() is None:
            proc.kill()

    if error or not result:
        print(f"SEPARATION FAILED: {error or 'no result'}", file=sys.stderr)
        return 1

    elapsed = time.time() - t0
    print(f"Separation completed in {elapsed:.1f}s — verifying outputs:")
    ok = True
    for stem in result["stems"]:
        try:
            dur = verify_stem(stem["path"], expected_duration)
            print(f"  OK  {stem['stem']:<14} {stem['path']}  ({dur:.2f}s)")
        except RuntimeError as e:
            print(f"  FAIL {stem['stem']:<14} {e}")
            ok = False

    passed = ok and len(result["stems"]) == len(stems)
    print("RESULT:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
