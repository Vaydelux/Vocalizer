#!/usr/bin/env python3
"""
Local Audio Studio — inference worker.

Speaks the typed JSON-over-stdio protocol defined in
`electron/shared/inference-protocol.ts`. The Electron main process spawns this
worker, sends `init`/`separate`/`cancel`/`shutdown` requests on stdin, and
reads `ready`/`progress`/`result`/`error` responses on stdout. Diagnostics go
to stderr (stdout is reserved for protocol messages).

The worker wraps `audio-separator` (python-audio-separator), which performs
REAL neural-network separation via ONNX Runtime (MDX-Net) or PyTorch (Demucs /
RoFormer). No results are fabricated.

Verified environment (this build): Python 3.12, audio-separator 0.47.2,
onnxruntime 1.31.1 (CPUExecutionProvider), PyTorch 2.15.0+cpu, FFmpeg 7.1.
Model: UVR-MDX-NET-Inst_HQ_5.onnx (~59 MB, downloaded on first use from the
public UVR model repo). Real two-stem separation verified on a 10 s test
signal in ~25 s on CPU.

Usage (standalone, for command-line verification before Electron integration):
    echo '{"type":"init","protocolVersion":1}' | python3 main.py

    echo '{"type":"separate","requestId":"r1","modelId":"UVR-MDX-NET-Inst_HQ_5.onnx","modelPath":"UVR-MDX-NET-Inst_HQ_5.onnx","architecture":"mdx-net","inputPath":"/in/song.wav","outputDir":"/out","requestedStems":["Vocals","Instrumental"],"outputFormat":"wav","device":"cpu"}' | python3 main.py
"""

from __future__ import annotations
import json
import os
import signal
import sys
import threading
import traceback
from typing import Any

from protocol import (
    parse_request, serialize_response,
    READY, PROGRESS, RESULT, ERROR,
)
from separator_service import SeparatorService
from runtime_detection import detect_runtimes
from errors import WorkerError

# stdout is reserved for protocol messages — all diagnostics go to stderr.
def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)

service: SeparatorService | None = None
cancel_event = threading.Event()


def emit(response: dict[str, Any]) -> None:
    sys.stdout.write(serialize_response(response) + "\n")
    sys.stdout.flush()


def handle_init(req: dict[str, Any]) -> None:
    runtimes, devices = detect_runtimes()
    emit(READY(
        runtimes=runtimes,
        devices=devices,
    ))
    _log(f"worker ready — runtimes={runtimes} devices={devices}")


def handle_separate(req: dict[str, Any]) -> None:
    global service
    if service is None:
        service = SeparatorService()
    request_id = req["requestId"]
    cancel_event.clear()

    def on_progress(progress, stage):
        if cancel_event.is_set():
            return
        emit(PROGRESS(request_id, progress, stage))

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
            on_progress=on_progress,
            cancel_event=cancel_event,
        )
        if cancel_event.is_set():
            emit(ERROR(request_id, "cancelled", "Separation cancelled."))
            return
        emit(RESULT(
            request_id=request_id,
            stems=stems,
            model_used=model_used,
            device_used=device_used,
            fallback_used=fallback_used,
        ))
    except WorkerError as e:
        emit(ERROR(request_id, e.code, e.message))
    except Exception as e:  # noqa: BLE001 - protocol must survive unexpected failures
        _log(f"unhandled error: {e}\n{traceback.format_exc()}")
        emit(ERROR(request_id, "unknown", f"Unexpected error: {e}"))


def handle_cancel(req: dict[str, Any]) -> None:
    cancel_event.set()
    # No response required for cancel; the pending separate request emits error/cancelled.
    _log(f"cancel requested for {req.get('requestId')}")


def handle_shutdown() -> None:
    _log("shutdown received")
    raise SystemExit(0)


DISPATCH = {
    "init": handle_init,
    "load-model": lambda r: None,  # model loading happens per-separate; ack silently
    "separate": handle_separate,
    "cancel": handle_cancel,
    "shutdown": lambda r: handle_shutdown(),
}


def main() -> None:
    # Cooperative SIGINT handling.
    signal.signal(signal.SIGINT, lambda *_: raise_system_exit())
    def raise_system_exit():
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, lambda *_: raise_system_exit())

    _log("inference worker started, waiting for protocol messages on stdin")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = parse_request(line)
        if req is None:
            _log(f"ignoring non-protocol line: {line[:80]}")
            continue
        handler = DISPATCH.get(req.get("type"))
        if handler is None:
            _log(f"unknown message type: {req.get('type')}")
            continue
        try:
            handler(req)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            _log(f"handler error for {req.get('type')}: {e}\n{traceback.format_exc()}")
    _log("stdin closed, worker exiting")


if __name__ == "__main__":
    main()
