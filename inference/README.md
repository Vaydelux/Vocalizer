# Local Audio Studio — Inference Worker

Real, local, CPU-based vocal/instrumental separation using
[python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
backed by ONNX Runtime (MDX-Net) and PyTorch (Demucs/RoFormer). No cloud. No
fabricated results.

## Status

**Verified on Linux x64 CPU** (the only environment available in this build):

| Component | Version |
|---|---|
| Python | 3.12.16 |
| audio-separator | 0.47.2 |
| onnxruntime | 1.31.1 (CPUExecutionProvider) |
| torch | 2.15.0+cpu |
| torchvision | 0.29.2+cpu |
| FFmpeg / FFprobe | 7.1.5 (system) |
| Model | UVR-MDX-NET-Inst_HQ_5.onnx (MDX-Net, ~59 MB) |

A 10 s test signal was separated into two real, decodable, non-identical,
non-silent stems (vocals + instrumental) in **~25 s** on CPU.

### Phase 5.2 live verification (parent/child architecture)

The full protocol was re-verified end-to-end against the real model through the
subprocess-per-job architecture introduced in Phase 5.2:

| Check | Result |
|---|---|
| `init` → `ready` | real runtimes reported (onnxruntime 1.31.1, torch 2.15.0+cpu) |
| Stage progress | `Preparing` → `Loading model` → `Running inference` (all `progress: null`, indeterminate — never fabricated), then measured `0.0/0.5/1.0` during `Verifying outputs` |
| `cancel` mid-inference | **0.06 s latency**, `code:"cancelled"`, zero leftover partial stems |
| `cancel` with no active job | protocol-legal `code:"unknown"` error response |
| `separate` → `result` | 2 FFprobe-verified stems, distinct MD5s, correct duration |
| `shutdown` racing completion | completed stems protected via `result_paths`, never deleted |

Defects found and fixed by this verification: uninitialized `JobRunner` state
(crashed `cancel` before the first job), dropped `segmentSize` field (child was
silently pinned to 256), `input-invalid` error code not in the protocol enum
(message would be dropped by the Electron Zod parser), orphaned child on stdin
EOF, and noisy BrokenPipeError crashes when the parent disappears.

### Memory constraint (sandbox only)

This 4 GB cgroup sandbox (with the dev server resident) cannot fit the default
`segmentSize: 256` for longer clips alongside the parent process — the child is
OOM-killed by the kernel. Pass a smaller `segmentSize` (e.g. 128) in constrained
environments; real Windows hardware is unaffected.

## Standalone verification (no Electron required)

```bash
# 1. Install CPU deps (use a venv)
pip install -r inference/requirements/cpu.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

# 2. Run the worker standalone — init handshake
echo '{"type":"init","protocolVersion":1}' | python3 inference/worker/main.py
# → {"type":"ready","protocolVersion":1,"devices":["cpu"],"runtimes":{...}}

# 3. Real separation through the protocol
printf '%s\n%s\n%s\n' \
  '{"type":"init","protocolVersion":1}' \
  '{"type":"separate","requestId":"r1","modelId":"UVR-MDX-NET-Inst_HQ_5.onnx","modelPath":"/absolute/path/to/UVR-MDX-NET-Inst_HQ_5.onnx","architecture":"mdx-net","inputPath":"/path/to/song.wav","outputDir":"/path/to/out","requestedStems":["Vocals","Instrumental"],"outputFormat":"wav","device":"cpu"}' \
  '{"type":"shutdown"}' \
  | python3 inference/worker/main.py
```

**Local-only preview behavior:** Vocalizer now requires an existing, lawfully
obtained copy of `UVR-MDX-NET-Inst_HQ_5.onnx` (59,074,342 bytes, SHA-256
`811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000`).
The Electron Remover page offers a native ONNX file picker. The main process
and Python worker verify the exact model before running; missing or corrupted
files fail rather than requesting a download. The local checkpoint is only a
testing option until the model's redistribution permissions are confirmed.

The standalone protocol request must provide an **absolute local modelPath**;
a model filename alone no longer activates a download. Outputs are checked
with FFprobe before the result message is emitted. Offline execution has not
yet passed a Windows installed-app acceptance test.

## Protocol

Typed JSON over stdin/stdout (mirrors `electron/shared/inference-protocol.ts`):

- Main → worker: `init`, `load-model`, `separate`, `cancel`, `shutdown`
- Worker → main: `ready`, `progress`, `result`, `error`

stdout is reserved for protocol messages; diagnostics go to stderr.

## Files

```
inference/worker/
├── main.py                 # stdin/stdout protocol loop + dispatch
├── protocol.py             # message construction + parsing
├── separator_service.py    # wraps audio-separator, real inference
├── audio_validation.py     # FFprobe output verification
├── runtime_detection.py    # onnxruntime/torch/CUDA probing
└── errors.py               # typed WorkerError
inference/requirements/cpu.txt   # pinned CPU deps
```

## Windows packaging (BLOCKED in this environment)

For the Windows installer, bundle a self-contained runtime via PyInstaller
`--onedir` (directory-based for inspectability of large ML deps):

```
resources/inference/
├── inference-worker.exe
├── _internal/              # PyTorch, onnxruntime, numpy, ... (CPU wheels)
└── runtime-manifest.json
resources/models/default/
├── model.onnx              # UVR-MDX-NET-Inst_HQ_5.onnx
└── manifest.json
```

`electron-builder.yml` `extraResources` maps `inference-dist/windows-x64/` →
`resources/inference/` inside the installed app, plus `resources/models/default/`
after the licensing gate. The Electron worker manager
(`electron/main/services/inference-worker.ts`) resolves, in order: the frozen
onedir executable (`<resourcesPath>/inference/inference-worker.exe`, or
`inference-dist/windows-x64/` for dev builds), then a script + interpreter pair
(bundled runtime Python, or `LAS_INFERENCE_PYTHON` as an explicit dev opt-in).
`isWorkerAvailable()` is true only when one of those layouts actually exists on
disk.

**This packaging was NOT produced or tested here** — no Windows toolchain,
PyInstaller-on-Windows, or display to launch Electron exists in this Linux
sandbox.

## Licensing gate (BLOCKED)

Redistribution rights for `UVR-MDX-NET-Inst_HQ_5.onnx` are **unverified**.
The model is downloaded at runtime for verification but is NOT bundled in this
repository. Bundled-default distribution remains blocked until the model's
license/redistribution permission is confirmed (or a compatible alternative with
verified rights is chosen).
