"""Real packaged CPU RoFormer smoke using a tiny original synthetic checkpoint.

Creates a new random-weight architecture purely for testing. This validates
tensor loading/shape, FFmpeg decode/encode, worker execution and output claims;
it does NOT measure separation quality or compatibility with user checkpoints.

Usage: python scripts/smoke-local-roformer.py --exe <worker> --ffmpeg <ffmpeg> --ffprobe <ffprobe>
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys

def run(argv: list[str], *, env=None, timeout=180):
    result = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError(
            f"{argv[0]} returned {result.returncode}: {result.stderr[-700:]} / {result.stdout[-700:]}"
        )
    return result.stdout

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    args = parser.parse_args()
    # Test the actual MSST architecture used by the user's converted models,
    # not just the generic upstream model exercised by older smoke checks.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
    from msst_roformer import MelBandRoformer, BSRoformer
    from safetensors.torch import save_file
    import torch

    root = Path(tempfile.mkdtemp(prefix="vocalizer-roformer-smoke-"))
    import shutil
    try:
        model_dir = root / "mel_band_roformer" / "vocals"
        model_dir.mkdir(parents=True)
        checkpoint = model_dir / "model.safetensors"
        config = model_dir / "config.yaml"
        kwargs = {
            "dim": 8, "depth": 1, "stereo": True, "num_stems": 1,
            "time_transformer_depth": 1, "freq_transformer_depth": 1,
            "linear_transformer_depth": 0, "num_bands": 8,
            "heads": 1, "dim_head": 8, "flash_attn": False,
            "sample_rate": 8000, "dim_freqs_in": 65,
            "stft_n_fft": 128, "stft_hop_length": 32, "stft_win_length": 128,
            "mask_estimator_depth": 1,
            "mlp_expansion_factor": 2,
            "use_torch_checkpoint": False,
            "skip_connection": False,
        }
        import inspect
        signature = inspect.signature(MelBandRoformer.__init__).parameters
        if "num_residual_streams" in signature:
            kwargs["num_residual_streams"] = 1
        torch.set_num_threads(2)
        model = MelBandRoformer(**kwargs)
        save_file({name: value.detach().contiguous().cpu()
                   for name, value in model.state_dict().items()}, str(checkpoint))
        del model
        model_config = {
            "dim": 8, "depth": 1, "stereo": True, "num_stems": 1,
            "time_transformer_depth": 1, "freq_transformer_depth": 1,
            "linear_transformer_depth": 0, "num_bands": 8,
            "heads": 1, "dim_head": 8, "flash_attn": False,
            "sample_rate": 8000, "dim_freqs_in": 65,
            "stft_n_fft": 128, "stft_hop_length": 32, "stft_win_length": 128,
            "mask_estimator_depth": 1,
            "mlp_expansion_factor": 2,
            "use_torch_checkpoint": False,
            "skip_connection": False,
        }
        # Only include CPU-safe architectural parameters supported by this version.
        model_config = {k:v for k,v in model_config.items() if k in signature}
        import yaml
        config.write_text(yaml.safe_dump({
            "audio": {"chunk_size": 8000, "sample_rate": 8000, "num_channels": 2},
            "model": model_config,
            "training": {"instruments": ["vocals", "other"], "target_instrument": "vocals"},
            "inference": {"num_overlap": 2},
        }), encoding="utf-8")
        input_file = root / "test.wav"
        run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
             "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=1.4",
             "-ac", "2", "-c:a", "pcm_s16le", str(input_file)])
        output_dir = root / "out"
        output_dir.mkdir()
        job = root / "job.json"
        job.write_text(json.dumps({
            "requestId": "roformer-ci", "modelId": "model.safetensors",
            "modelPath": str(checkpoint), "configPath": str(config),
            "architecture": "melband-roformer", "inputPath": str(input_file),
            "outputDir": str(output_dir),
            "requestedStems": ["Vocals", "Instrumental"],
            "outputFormat": "wav24", "device": "cpu", "profile": "low-memory",
        }), encoding="utf-8")
        env = os.environ.copy()
        env["LAS_FFMPEG_PATH"] = str(Path(args.ffmpeg).resolve())
        env["LAS_FFPROBE_PATH"] = str(Path(args.ffprobe).resolve())
        worker = run([str(Path(args.exe).resolve()), "--job", str(job)],
                     env=env, timeout=240)
        result = next((json.loads(line) for line in worker.splitlines()
                       if line.startswith("{") and json.loads(line).get("type") == "result"), None)
        if not result or {s["stem"] for s in result["stems"]} != {"Vocals", "Instrumental"}:
            raise AssertionError(f"Packaged RoFormer did not produce two verified stems: {worker[-900:]}")
        for item in result["stems"]:
            file_path = Path(item["path"])
            if not file_path.is_file() or file_path.stat().st_size < 1000:
                raise AssertionError(f"Missing or empty RoFormer output: {item}")
        print("Packaged CPU MSST MelBand RoFormer (MLP expansion=2) verified.")

        # MSST BS retains a singleton stem dimension for one-target inference
        # (b,1,channels,frames), unlike MelBand. Exercise the complete worker
        # inference path to protect this important model-family distinction.
        bs_dir = root / "bs_roformer" / "vocals"
        bs_dir.mkdir(parents=True)
        bs_weights = bs_dir / "model.safetensors"
        bs_config = bs_dir / "config.yaml"
        bs_kwargs = {
            "dim": 8, "depth": 1, "stereo": True, "num_stems": 1,
            "time_transformer_depth": 1, "freq_transformer_depth": 1,
            "linear_transformer_depth": 0,
            "freqs_per_bands": (16, 16, 16, 17),
            "heads": 1, "dim_head": 8, "flash_attn": False,
            "dim_freqs_in": 65,
            "stft_n_fft": 128, "stft_hop_length": 32, "stft_win_length": 128,
            "mask_estimator_depth": 1,
            "mlp_expansion_factor": 2,
            "use_torch_checkpoint": False, "skip_connection": False,
        }
        bs_model = BSRoformer(**bs_kwargs)
        save_file({name: tensor.detach().contiguous().cpu()
                   for name, tensor in bs_model.state_dict().items()},
                  str(bs_weights))
        del bs_model
        bs_config.write_text(yaml.safe_dump({
            "audio": {"chunk_size": 8000, "sample_rate": 8000, "num_channels": 2},
            "model": bs_kwargs,
            "training": {"instruments": ["vocals", "other"], "target_instrument": "vocals"},
            "inference": {"num_overlap": 2},
        }), encoding="utf-8")
        bs_out = root / "bs-out"
        bs_out.mkdir()
        bs_job = root / "bs-job.json"
        bs_job.write_text(json.dumps({
            "requestId": "bs-roformer-ci", "modelId": "model.safetensors",
            "modelPath": str(bs_weights), "configPath": str(bs_config),
            "architecture": "bs-roformer", "inputPath": str(input_file),
            "outputDir": str(bs_out), "requestedStems": ["Vocals", "Instrumental"],
            "outputFormat": "wav24", "device": "cpu", "profile": "low-memory",
        }), encoding="utf-8")
        bs_worker = run([str(Path(args.exe).resolve()), "--job", str(bs_job)],
                        env=env, timeout=240)
        bs_result = next((json.loads(line) for line in bs_worker.splitlines()
                          if line.startswith("{") and json.loads(line).get("type") == "result"), None)
        if not bs_result or {stem["stem"] for stem in bs_result["stems"]} != {"Vocals", "Instrumental"}:
            raise AssertionError(f"Packaged MSST BS-RoFormer failed: {bs_worker[-900:]}")
        for item in bs_result["stems"]:
            stem_file = Path(item["path"])
            if not stem_file.is_file() or stem_file.stat().st_size < 1000:
                raise AssertionError(f"Missing BS-RoFormer audio: {item}")
        print("Packaged CPU MSST BS-RoFormer (single-output 4D tensor) verified.")
    finally:
        shutil.rmtree(root, ignore_errors=True)

if __name__ == "__main__":
    main()
