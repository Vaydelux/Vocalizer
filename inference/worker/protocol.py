"""Protocol helpers — JSON-over-stdio message construction + parsing.

Mirrors `electron/shared/inference-protocol.ts` exactly. stdout is reserved for
these messages; everything else goes to stderr.
"""

from __future__ import annotations
import json
from typing import Any

READY_TYPE = "ready"
PROGRESS_TYPE = "progress"
RESULT_TYPE = "result"
ERROR_TYPE = "error"

PROTOCOL_VERSION = 1


def serialize_response(resp: dict[str, Any]) -> str:
    return json.dumps(resp, separators=(",", ":"))


def READY(runtimes: list[str], devices: list[str]) -> dict[str, Any]:
    return {
        "type": READY_TYPE,
        "protocolVersion": PROTOCOL_VERSION,
        "devices": devices,
        "runtimes": {r: r for r in runtimes},
    }


def PROGRESS(request_id: str, progress: float | None, stage: str) -> dict[str, Any]:
    return {
        "type": PROGRESS_TYPE,
        "requestId": request_id,
        "progress": progress,
        "stage": stage,
    }


def RESULT(request_id: str, stems: list[dict[str, Any]], model_used: str,
           device_used: str, fallback_used: bool) -> dict[str, Any]:
    return {
        "type": RESULT_TYPE,
        "requestId": request_id,
        "stems": stems,
        "modelUsed": model_used,
        "deviceUsed": device_used,
        "fallbackUsed": fallback_used,
    }


def ERROR(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "type": ERROR_TYPE,
        "requestId": request_id,
        "code": code,
        "message": message,
    }


def parse_request(line: str) -> dict[str, Any] | None:
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(msg, dict) or "type" not in msg:
        return None
    return msg
