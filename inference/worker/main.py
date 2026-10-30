#!/usr/bin/env python3
"""
Local Audio Studio — inference worker.

Speaks the typed JSON-over-stdio protocol defined in
`electron/shared/inference-protocol.ts`.

Process model (fixed in Phase 5.2 — the previous single-process design blocked
`cancel` while inference ran):

  Parent (this process, default mode)
    - Reads protocol requests from stdin; the loop NEVER blocks on inference.
    - `separate` → spawns a child process (`--job <tmpfile>`) that performs the
      actual inference; forwards the child's protocol messages to stdout.
    - `cancel` → kills the active child, removes incomplete output files, and
      emits `error{code:"cancelled"}`. The parent stays alive for later jobs.
  Child (`main.py --job <file>`)
    - Runs one separation job and emits `progress`/`result`/`error` on stdout.

stdout is reserved for protocol messages; all diagnostics go to stderr.
"""

from __future__ import annotations
import glob
import json
import os
import signal
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time
import traceback
from typing import Any

from protocol import parse_request, serialize_response, ERROR as ERROR_MSG

# ---------------------------------------------------------------------------
# Child mode: run exactly one separation job, emit protocol messages, exit.
# ---------------------------------------------------------------------------

def run_job_child(job_file: str) -> int:
    # NOTE: the job file is deleted by the PARENT after the child exits — the
    # child must not delete it (a double-delete raced the next job's mkstemp).
    try:
        with open(job_file, "r", encoding="utf-8") as fh:
            req: dict[str, Any] = json.load(fh)
    except Exception as e:  # noqa: BLE001 — emit a protocol error, never crash silently
        # NOTE: "unknown" is a protocol-legal error code (mirrors the TS enum in
        # electron/shared/inference-protocol.ts). An unreadable job file is an
        # internal failure, and an unrecognized code would be DROPPED by the
        # Electron-side Zod parser instead of surfacing to the user.
        print(json.dumps({"type": "error", "requestId": "?", "code": "unknown",
                          "message": f"Cannot read job file: {e}"}), file=sys.stdout, flush=True)
        return 1

    # Local imports keep parent startup fast.
    from separator_service import SeparatorService
    from errors import WorkerError

    def emit(resp: dict[str, Any]) -> None:
        try:
            sys.stdout.write(serialize_response(resp) + "\n")
            sys.stdout.flush()
        except BrokenPipeError:
            # The parent is gone (crashed/exited) — nothing left to report to.
            # Exit quietly instead of crashing through the inference stack.
            sys.exit(3)

    request_id = req["requestId"]
    service = SeparatorService()
    try:
        stems, model_used, device_used, fallback_used = service.separate(
            model_id=req["modelId"],
            model_path=req["modelPath"],
            architecture=req.get("architecture", "mdx-net"),
            config_path=req.get("configPath"),
            input_path=req["inputPath"],
            output_dir=req["outputDir"],
            requested_stems=req["requestedStems"],
            output_format=req.get("outputFormat", "wav"),
            device=req.get("device", "cpu"),
            on_progress=lambda p, s: emit({"type": "progress", "requestId": request_id, "progress": p, "stage": s}),
            profile=req.get("profile", "balanced"),
            segment_size=req.get("segmentSize"),
        )
        emit({
            "type": "result",
            "requestId": request_id,
            "stems": stems,
            "modelUsed": model_used,
            "deviceUsed": device_used,
            "fallbackUsed": fallback_used,
        })
        return 0
    except WorkerError as e:
        emit({"type": "error", "requestId": request_id, "code": e.code, "message": e.message})
        return 1
    except Exception as e:  # noqa: BLE001 — a crash must still emit a protocol error
        print(f"child unhandled error: {e}\n{traceback.format_exc()}", file=sys.stderr, flush=True)
        emit({"type": "error", "requestId": request_id, "code": "unknown", "message": f"Unexpected error: {e}"})
        return 2


# ---------------------------------------------------------------------------
# Parent mode: responsive stdin loop + subprocess-per-job isolation.
# ---------------------------------------------------------------------------

class JobRunner:
    """Tracks the active separation child; supports cancel + cleanup.

    The child's stdout is forwarded on a BACKGROUND THREAD so the parent's
    stdin loop never blocks — `cancel` messages are processed immediately,
    even mid-inference. (The previous single-threaded design re-introduced
    the exact blocking defect this phase set out to fix.)
    """

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.request_id: str | None = None
        self.output_dir: str | None = None
        self.input_basename: str | None = None
        self.pre_existing: set[str] = set()
        self.job_start: float = 0.0
        self.cancelled = False
        self.write_lock = threading.Lock()
        # Initialize ALL mutable job state here — `cancel`/`shutdown` may arrive
        # before the first `separate`, and touching an unset attribute would
        # crash the handler and leave the request unanswered (found by live
        # protocol testing in Phase 5.2).
        self.completed = False
        self.result_paths: set[str] = set()
        self._job_file: str | None = None

    @property
    def active(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, req: dict[str, Any]) -> str | None:
        """Write the job file and spawn the child. Returns an error message or None."""
        if self.active:
            return "A separation job is already running."
        job = {
            "requestId": req["requestId"],
            "modelId": req["modelId"],
            "modelPath": req["modelPath"],
            "architecture": req.get("architecture", "mdx-net"),
            "configPath": req.get("configPath"),
            "inputPath": req["inputPath"],
            "outputDir": req["outputDir"],
            "requestedStems": req["requestedStems"],
            "outputFormat": req.get("outputFormat", "wav"),
            "device": req.get("device", "cpu"),
            # Forward the optional inference knob — dropping it here would
            # silently pin the child to the 256 default (found by live testing:
            # a 128 request kept running at 256 and OOM-killed in the 4GB
            # sandbox cgroup).
            "segmentSize": req.get("segmentSize"),
            "profile": req.get("profile", "balanced"),
        }
        fd, job_file = tempfile.mkstemp(prefix="las-job-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(job, fh)
        self._job_file = job_file

        self.request_id = req["requestId"]
        self.cancelled = False
        self.completed = False
        self.result_paths: set[str] = set()
        self.output_dir = req["outputDir"]
        self.input_basename = os.path.splitext(os.path.basename(req["inputPath"]))[0]
        try:
            self.pre_existing = set(os.listdir(self.output_dir)) if os.path.isdir(self.output_dir) else set()
        except OSError:
            self.pre_existing = set()
        self.job_start = time.time()

        python = sys.executable or sysconfig.get_executable() or "python3"
        # A PyInstaller executable is itself the interpreter/entrypoint.
        # Passing __file__ as an argv entry would cause the frozen worker to
        # enter parent mode again instead of the --job child mode.
        command = (
            [python, "--job", job_file]
            if getattr(sys, "frozen", False)
            else [python, os.path.abspath(__file__), "--job", job_file]
        )
        self.proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            # Inherit stderr: the child's diagnostics go straight to the app's
            # stderr. (A PIPE that is never drained would deadlock the child.)
            stderr=None,
            shell=False,
            text=True,
        )
        return None

    def cancel(self) -> bool:
        """Kill the active child; return True if a job was cancelled.

        A job that has already COMPLETED successfully is never cancelled and its
        outputs are never cleaned — a shutdown racing the completion must not
        delete just-written stems. (Found by live testing in Phase 5.2.)
        """
        if self.completed:
            return False
        if self.proc is not None and self.proc.poll() is not None:
            # The child just exited; treat a clean exit as completion.
            if self.proc.returncode == 0:
                self.completed = True
                self.proc = None
                return False
        if not self.active:
            return False
        self.cancelled = True
        proc = self.proc
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], shell=False, capture_output=True)
            else:
                proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        self._cleanup_partial_outputs()
        if self._job_file:
            try:
                os.remove(self._job_file)
            except OSError:
                pass
            self._job_file = None
        self.proc = None
        return True

    def _cleanup_partial_outputs(self) -> None:
        """Remove incomplete stem files created by a cancelled job.

        Files reported in a `result` message are COMPLETED outputs and are
        never deleted — a cancel/shutdown racing the child's exit must not
        destroy just-written stems.
        """
        if not self.output_dir or not os.path.isdir(self.output_dir):
            return
        for name in os.listdir(self.output_dir):
            if name in self.pre_existing:
                continue
            lowered = name.lower()
            if any(t in lowered for t in ("(vocals)", "(instrumental)", "(drums)", "(bass)", "(other)", "(guitar)", "(piano)")):
                full = os.path.join(self.output_dir, name)
                if full in self.result_paths:
                    continue  # completed output — never delete
                try:
                    os.remove(full)
                    print(f"removed incomplete output: {name}", file=sys.stderr, flush=True)
                except OSError:
                    pass

    def forward_output(self, emit) -> None:
        """Forward the child's protocol stdout to the parent's stdout.

        Runs on a background thread. The child already emits serialized protocol
        lines — they are passed through VERBATIM (no re-serialization). When a
        `result` message is seen, its stem paths are recorded so a later
        cancel/shutdown can never delete completed outputs.
        """
        if not self.proc or not self.proc.stdout:
            return
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    if msg.get("type") == "result":
                        for s in msg.get("stems", []):
                            self.result_paths.add(s.get("path", ""))
                except (json.JSONDecodeError, AttributeError):
                    pass
                with self.write_lock:
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
        except (OSError, ValueError):
            pass  # child killed / stream closed during cancel
        finally:
            self.finish(emit)

    def finish(self, emit) -> None:
        """Called (from the forwarder thread) after the child exits."""
        if not self.proc:
            return
        code = self.proc.wait()
        self.proc = None
        if code == 0:
            self.completed = True
        # The parent owns the job temp file's lifecycle — remove it once the
        # child has exited (the child never deletes it; that raced before).
        if self._job_file:
            try:
                os.remove(self._job_file)
            except OSError:
                pass
            self._job_file = None
        if self.cancelled:
            return  # the cancel handler already emitted the cancelled error
        if code not in (0, 1):  # 0=success, 1=protocol error emitted by child
            with self.write_lock:
                emit(ERROR_MSG(self.request_id or "?", "unknown", f"Inference worker process exited with code {code}."))


runner = JobRunner()


def emit(response: dict[str, Any]) -> None:
    sys.stdout.write(serialize_response(response) + "\n")
    sys.stdout.flush()


def handle_init(_req: dict[str, Any]) -> None:
    from runtime_detection import detect_runtimes
    runtimes, devices = detect_runtimes()
    emit({"type": "ready", "protocolVersion": 1, "devices": devices, "runtimes": {r: r for r in runtimes}})


def handle_separate(req: dict[str, Any]) -> None:
    err = runner.start(req)
    if err:
        emit(ERROR_MSG(req["requestId"], "unknown", err))
        return
    # Forward the child's output on a background thread; the stdin loop stays
    # responsive so `cancel` is processed immediately, even mid-inference.
    forwarder = threading.Thread(target=runner.forward_output, args=(emit,), daemon=True)
    forwarder.start()


def handle_cancel(req: dict[str, Any]) -> None:
    # Only the owner of the active request may cancel it. A stale job ID must
    # never interrupt a later, unrelated separation job.
    if not runner.active or runner.request_id != req.get("requestId"):
        emit(ERROR_MSG(req.get("requestId", "?"), "unknown", "No matching active separation job to cancel."))
        return
    if runner.cancel():
        with runner.write_lock:
            emit(ERROR_MSG(runner.request_id or req.get("requestId", "?"), "cancelled", "Separation cancelled."))
    else:
        emit(ERROR_MSG(req.get("requestId", "?"), "unknown", "No active separation job to cancel."))


def handle_shutdown(_req: dict[str, Any]) -> None:
    # Graceful shutdown: never orphan a running inference child. Cancel the
    # active job (killing the child + cleaning partial outputs) before exiting.
    if runner.active:
        print("shutdown with active job — cancelling", file=sys.stderr, flush=True)
        if runner.cancel():
            with runner.write_lock:
                emit(ERROR_MSG(runner.request_id or "?", "cancelled", "Separation cancelled during shutdown."))
    raise SystemExit(0)


DISPATCH = {
    "init": handle_init,
    "load-model": lambda r: None,  # per-job loading; acknowledged silently
    "separate": handle_separate,
    "cancel": handle_cancel,
    "shutdown": handle_shutdown,
}


def parent_main() -> None:
    print("inference worker started (subprocess-per-job model)", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = parse_request(line)
        if req is None:
            print(f"ignoring non-protocol line: {line[:80]}", file=sys.stderr, flush=True)
            continue
        handler = DISPATCH.get(req.get("type"))
        if handler is None:
            print(f"unknown message type: {req.get('type')}", file=sys.stderr, flush=True)
            continue
        try:
            handler(req)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001 — the parent must survive handler errors
            print(f"handler error for {req.get('type')}: {e}\n{traceback.format_exc()}", file=sys.stderr, flush=True)
    print("stdin closed, worker exiting", file=sys.stderr, flush=True)
    # EOF on stdin means the Electron side (or test driver) is gone. Never
    # orphan a running inference child — cancel it (kills the child + cleans
    # partial outputs) before exiting. Found by live testing in Phase 5.2: a
    # driver hang-up left the child burning CPU on a broken pipe.
    if runner.active:
        print("stdin EOF with active job — cancelling before exit", file=sys.stderr, flush=True)
        runner.cancel()


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "--job":
        sys.exit(run_job_child(sys.argv[2]))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    parent_main()


if __name__ == "__main__":
    main()
