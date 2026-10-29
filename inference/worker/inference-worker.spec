# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the Local Audio Studio inference worker (Windows x64).
#
# Build on a Windows host with the CPU-only environment from
# inference/requirements/cpu.txt installed:
#   pip install pyinstaller
#   pyinstaller inference/worker/inference-worker.spec --noconfirm
#
# Output (directory-based, easy to inspect/troubleshoot large ML deps):
#   inference-dist/windows-x64/
#     ├── inference-worker.exe
#     ├── _internal/          (onnxruntime DLLs, torch CPU, numpy, ...)
#     └── runtime-manifest.json
#
# NOTE: produced and verified only on Windows — this spec was NOT executed in
# the Linux development sandbox (PyInstaller cannot cross-compile).

import json
import os
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

block_cipher = None

datas = [
    # ONNX Runtime + torch CPU native libs are collected explicitly below.
]
datas += collect_data_files("onnxruntime")
datas += collect_data_files("audio_separator")

binaries = []
binaries += collect_dynamic_libs("onnxruntime")
binaries += collect_dynamic_libs("torch")

hiddenimports = [
    "audio_separator",
    "audio_separator.separator",
    "audio_separator.separator.architectures.mdx_separator",
    "onnxruntime",
    "torch",
    "torchvision",
    "onnx2torch",
    "numpy",
    "scipy",
    "librosa",
    "soundfile",
    "pydub",
]

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pandas", "IPython", "jupyter"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="inference-worker",
    debug=False,
    strip=False,
    upx=False,
    console=True,  # protocol goes over stdio; a console window is required
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="inference-worker",
)

# Emit a runtime manifest describing the packaged worker (consumed by Electron).
manifest = {
    "worker": "inference-worker.exe",
    "protocolVersion": 1,
    "platform": "windows-x64",
    "builtWithPyInstaller": True,
}
out_dir = os.path.join(os.path.dirname(SPECPATH), "..", "dist", "inference-worker")
try:
    with open(os.path.join(SPECPATH, "runtime-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
except OSError:
    pass
