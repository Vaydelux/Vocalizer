"""Minimal smoke check for the frozen worker's versioned init protocol.

This does NOT test model loading, real separation or the Electron GUI.
"""
import argparse
import json
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--exe", required=True)
args = parser.parse_args()
proc = subprocess.Popen([args.exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    stdout, stderr = proc.communicate(
        '{"type":"init","protocolVersion":1}\n{"type":"shutdown"}\n',
        timeout=120,
    )
except subprocess.TimeoutExpired:
    proc.kill()
    proc.communicate()
    raise SystemExit("Worker handshake timed out")
messages = []
for line in stdout.splitlines():
    try:
        messages.append(json.loads(line))
    except json.JSONDecodeError:
        raise SystemExit(f"Non-JSON protocol output: {line[:120]}")
if not any(msg.get("type") == "ready" and msg.get("protocolVersion") == 1 for msg in messages):
    print(stderr[-2000:], file=sys.stderr)
    raise SystemExit("Frozen worker did not emit protocol v1 ready")
if proc.returncode != 0:
    raise SystemExit(f"Frozen worker exited with code {proc.returncode}")
print("PASS: frozen worker protocol v1 initialization/shutdown")
