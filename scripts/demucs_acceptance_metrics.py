"""Measured Windows worker CPU/RSS and PCM24 seam diagnostics.

This module is used by CI acceptance, never by the application runtime.
RSS is the sampled *sum* of worker-parent and descendant process RSS, so
shared DLL pages may be counted more than once. It is not private commit.
"""
from __future__ import annotations

import math
from pathlib import Path
import subprocess
import time
import wave


def run_monitored_worker(command: list[str], env: dict[str, str], timeout_seconds: int = 600) -> dict:
    """Run the real frozen worker and measure its process tree at ~0.2s intervals."""
    import psutil  # CI-only dependency, intentionally not bundled in the worker.

    started = time.perf_counter()
    proc = subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    root = psutil.Process(proc.pid)
    cpu_by_pid: dict[tuple[int, float], float] = {}
    peak_rss = 0
    peak_processes = 0
    try:
        while proc.poll() is None:
            if time.perf_counter() - started > timeout_seconds:
                proc.kill()
                raise subprocess.TimeoutExpired(command, timeout_seconds)
            try:
                members = [root] + root.children(recursive=True)
            except psutil.Error:
                members = []
            rss = 0
            alive = 0
            for member in members:
                try:
                    memory = member.memory_info()
                    cpu = member.cpu_times()
                    key = (member.pid, member.create_time())
                    cpu_by_pid[key] = max(cpu_by_pid.get(key, 0.0), cpu.user + cpu.system)
                    rss += memory.rss
                    alive += 1
                except psutil.Error:
                    continue
            peak_rss = max(peak_rss, rss)
            peak_processes = max(peak_processes, alive)
            time.sleep(0.2)
        stdout, stderr = proc.communicate(timeout=30)
        return {
            "returncode": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "wall_seconds": round(time.perf_counter() - started, 3),
            "sampled_peak_worker_tree_rss_mib": round(peak_rss / (1024**2), 1),
            "sampled_worker_tree_cpu_seconds": round(sum(cpu_by_pid.values()), 2),
            "max_live_worker_processes": peak_processes,
        }
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate()


def pcm24_step_at_frame(file: str | Path, frame_index: int, neighborhood: int = 96) -> float:
    """Return maximum adjacent normalized PCM24 step near a candidate seam.

    This is an objective *diagnostic*, not a proof of audible quality.
    """
    with wave.open(str(file), "rb") as reader:
        if reader.getsampwidth() != 3 or reader.getnchannels() != 2:
            raise ValueError("Boundary inspection requires stereo 24-bit WAV.")
        frames = reader.getnframes()
        if not 1 <= frame_index < frames:
            raise ValueError("Boundary frame lies outside the recording.")
        start = max(0, frame_index - neighborhood)
        stop = min(frames, frame_index + neighborhood + 1)
        reader.setpos(start)
        samples = reader.readframes(stop - start)
    stride = 6
    previous = None
    largest = 0
    for offset in range(0, len(samples), stride):
        sample = (
            int.from_bytes(samples[offset:offset + 3], "little", signed=True),
            int.from_bytes(samples[offset + 3:offset + 6], "little", signed=True),
        )
        if previous is not None:
            largest = max(largest, abs(sample[0] - previous[0]),
                          abs(sample[1] - previous[1]))
        previous = sample
    return largest / float(2**23)


def seam_step_metrics(path: str | Path, seconds: int, rate: int = 44100) -> dict:
    """Check both ends of each 0.25s crossfade in Low Memory mode.

    The first eight-second core ends at t=8. Subsequent core ends are
    separated by 7.75 seconds. All values are measured from the output.
    """
    if seconds <= 8:
        return {"crossfade_boundaries": 0, "max_near_seam_step_dbfs": None}
    max_step = 0.0
    sampled = 0
    core_end = 8.0
    while core_end < seconds:
        for position in (core_end - 0.25, core_end):
            max_step = max(max_step, pcm24_step_at_frame(path, round(position * rate)))
            sampled += 1
        core_end += 7.75
    dbfs = 20 * math.log10(max(max_step, 1 / 2**23))
    return {
        "crossfade_boundaries": sampled,
        "max_near_seam_step_dbfs": round(dbfs, 2),
    }
