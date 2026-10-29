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
  '{"type":"separate","requestId":"r1","modelId":"UVR-MDX-NET-Inst_HQ_5.onnx","modelPath":"UVR-MDX-NET-Inst_HQ_5.onnx","architecture":"mdx-net","inputPath":"/path/to/song.wav","outputDir":"/path/to/out","requestedStems":["Vocals","Instrumental"],"outputFormat":"wav","device":"cpu"}' \
  '{"type":"shutdown"}' \
  | python3 inference/worker/main.py
```

The model downloads automatically on first use (~59 MB) from the public UVR
model repo. Output files are FFprobe-verified by the worker before the `result`
message is emitted.

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

`electron-builder.yml` `extraResources` already includes `resources/binaries/`
and would include `resources/inference/` + `resources/models/default/`. The
Electron worker manager (`electron/main/services/inference-worker.ts`) resolves
the worker + Python runtime from `process.resourcesPath/inference/`.

**This packaging was NOT produced or tested here** — no Windows toolchain,
PyInstaller-on-Windows, or display to launch Electron exists in this Linux
sandbox.

## Licensing gate (BLOCKED)

Redistribution rights for `UVR-MDX-NET-Inst_HQ_5.onnx` are **unverified**.
The model is downloaded at runtime for verification but is NOT bundled in this
repository. Bundled-default distribution remains blocked until the model's
license/redistribution permission is confirmed (or a compatible alternative with
verified rights is chosen).
