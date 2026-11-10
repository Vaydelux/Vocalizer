"""Safetensors/YAML preflight tests using fake files, never user checkpoints."""
from __future__ import annotations

import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
from errors import WorkerError
from roformer_model import read_roformer_profile
from roformer_service import model_init_kwargs, roformer_backend

BASE_CONFIG = """audio:
  chunk_size: 8000
  num_channels: 2
  sample_rate: 8000
model:
  dim: 8
  depth: 1
  stereo: true
  num_stems: 1
  num_bands: 8
  multi_stft_resolutions_window_sizes: !!python/tuple [4096, 2048]
training:
  instruments: [vocals, other]
  target_instrument: vocals
inference:
  num_overlap: 2
"""


def fake_pair(folder: Path, config: str = BASE_CONFIG):
    folder.mkdir(parents=True, exist_ok=True)
    checkpoint = folder / "model.safetensors"
    header = json.dumps({"test.weight": {"dtype": "F32", "shape": [256],
                                         "data_offsets": [0, 1024]}}).encode()
    checkpoint.write_bytes(struct.pack("<Q", len(header)) + header + bytes(1024))
    configuration = folder / "config.yaml"
    configuration.write_text(config, encoding="utf-8")
    return checkpoint, configuration


class LocalRoformerTests(unittest.TestCase):
    def test_mel_band_two_stem_with_safe_tuple(self):
        with tempfile.TemporaryDirectory() as work:
            checkpoint, config = fake_pair(Path(work) / "mel_band_roformer" / "vocals_viperx")
            p = read_roformer_profile(
                str(checkpoint), str(config), "melband-roformer",
                ["Vocals", "Instrumental"],
            )
            self.assertEqual(p.stems, ("Vocals", "Instrumental"))
            self.assertEqual(p.architecture, "melband-roformer")
            self.assertEqual(p.model_kwargs["multi_stft_resolutions_window_sizes"], (4096, 2048))

    def test_four_stem_bs_roformer(self):
        four = BASE_CONFIG.replace("  num_bands: 8", "  freqs_per_bands: !!python/tuple [2, 2, 2, 2]")
        four = four.replace("num_stems: 1", "num_stems: 4")
        four = four.replace("instruments: [vocals, other]", "instruments: [drums, bass, other, vocals]")
        four = four.replace("target_instrument: vocals", "target_instrument: null")
        with tempfile.TemporaryDirectory() as work:
            checkpoint, config = fake_pair(Path(work) / "bs_roformer" / "multistem", four)
            p = read_roformer_profile(str(checkpoint), str(config), "bs-roformer",
                                      ["Vocals", "Drums", "Bass", "Other"])
            self.assertEqual(p.stems, ("Vocals", "Drums", "Bass", "Other"))
            self.assertEqual(p.instruments, ("drums", "bass", "other", "vocals"))
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(checkpoint), str(config), "melband-roformer")

    def test_msst_multistem_expansion_two_is_preserved(self):
        cfg = BASE_CONFIG.replace("num_bands: 8", "freqs_per_bands: !!python/tuple [2, 2, 2, 2]")
        cfg = cfg.replace("num_stems: 1", "num_stems: 4")
        cfg = cfg.replace("instruments: [vocals, other]", "instruments: [drums, bass, other, vocals]")
        cfg = cfg.replace("target_instrument: vocals", "target_instrument: null")
        cfg = cfg.replace("  depth: 1", "  depth: 1\n  mlp_expansion_factor: 2\n  use_torch_checkpoint: false\n  skip_connection: false")
        with tempfile.TemporaryDirectory() as work:
            cp, yaml = fake_pair(Path(work), cfg)
            profile = read_roformer_profile(str(cp), str(yaml), "bs-roformer",
                                            ["Vocals", "Drums", "Bass", "Other"])
            self.assertEqual(roformer_backend(profile), "msst")
            class FakeMSSTModel:
                def __init__(self, dim, depth, stereo, num_stems, freqs_per_bands,
                             mlp_expansion_factor=4, use_torch_checkpoint=False,
                             skip_connection=False, multi_stft_resolutions_window_sizes=None):
                    pass
            params = model_init_kwargs(profile, FakeMSSTModel)
            self.assertEqual(params["mlp_expansion_factor"], 2)
            self.assertFalse(params["use_torch_checkpoint"])
            self.assertFalse(params["skip_connection"])

    def test_msst_yaml_lists_become_validated_frequency_tuples(self):
        # PyYAML safe_dump serializes Python tuples as ordinary YAML lists.
        # MSST's beartype constructor requires genuine tuples at runtime.
        config_text = BASE_CONFIG.replace(
            "num_bands: 8", "freqs_per_bands: [2, 2, 2, 2]"
        ).replace(
            "!!python/tuple [4096, 2048]", "[4096, 2048]"
        )
        class FakeBSModel:
            def __init__(self, dim, depth, stereo, num_stems,
                         freqs_per_bands, multi_stft_resolutions_window_sizes):
                pass
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work), config_text)
            profile = read_roformer_profile(str(cp), str(config), "bs-roformer")
            params = model_init_kwargs(profile, FakeBSModel)
            self.assertEqual(params["freqs_per_bands"], (2, 2, 2, 2))
            self.assertEqual(params["multi_stft_resolutions_window_sizes"],
                             (4096, 2048))
            from dataclasses import replace
            for invalid in ([True, 2, 2, 2], [2, -1, 2, 2],
                            [2, "3", 2, 2], [], [1]):
                with self.subTest(value=invalid):
                    bad = replace(profile, model_kwargs={
                        **profile.model_kwargs, "freqs_per_bands": invalid,
                    })
                    with self.assertRaises(WorkerError):
                        model_init_kwargs(bad, FakeBSModel)

    def test_instrumental_other_target_and_real_two_output_heads(self):
        instrumental = BASE_CONFIG.replace("target_instrument: vocals", "target_instrument: other")
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work), instrumental)
            p = read_roformer_profile(str(cp), str(config), "melband-roformer")
            self.assertEqual(p.target, "instrumental")
            two = instrumental.replace("num_stems: 1", "num_stems: 2")
            two = two.replace("target_instrument: other", "target_instrument: null")
            config.write_text(two, encoding="utf-8")
            p2 = read_roformer_profile(str(cp), str(config), "melband-roformer")
            self.assertEqual(p2.model_kwargs["num_stems"], 2)
            self.assertIsNone(p2.target)

    def test_refuses_wrong_stem_set(self):
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work))
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(cp), str(config), "melband-roformer",
                                      ["Vocals", "Drums", "Bass", "Other"])

    def test_refuses_denoise_dereverb_without_relabeling(self):
        denoise = BASE_CONFIG.replace("instruments: [vocals, other]", "instruments: [dry, reverb]")
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work), denoise)
            with self.assertRaises(WorkerError) as failure:
                read_roformer_profile(str(cp), str(config), "melband-roformer")
            self.assertEqual(failure.exception.code, "architecture-unsupported")

    def test_rejects_unsafe_python_yaml_tags(self):
        unsafe = BASE_CONFIG + "arbitrary: !!python/object/apply:os.system ['echo unsafe']\n"
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work), unsafe)
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(cp), str(config), "melband-roformer")

    def test_rejects_corrupt_safetensors_and_path_mismatch(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            cp, config = fake_pair(root)
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(cp), str(root / "other.yaml"), "melband-roformer")
            cp.write_bytes(b"not safetensors")
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(cp), str(config), "melband-roformer")

    def test_rejects_wrong_unsafe_weights_structure_before_loading(self):
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work))
            cp.write_bytes(struct.pack("<Q", 0) + bytes(2048))
            with self.assertRaises(WorkerError):
                read_roformer_profile(str(cp), str(config), "melband-roformer")

    def test_constructor_rejects_unrecognized_architecture_changing_options(self):
        class FakeModel:
            def __init__(self, dim, depth, stereo, num_stems, num_bands, flash_attn=True):
                pass
        with tempfile.TemporaryDirectory() as work:
            cp, config = fake_pair(Path(work))
            profile = read_roformer_profile(str(cp), str(config), "melband-roformer")
            with self.assertRaises(WorkerError):
                model_init_kwargs(profile, FakeModel)
            simple = profile.model_kwargs.copy()
            simple.pop("multi_stft_resolutions_window_sizes")
            from dataclasses import replace
            ready = replace(profile, model_kwargs=simple)
            self.assertEqual(model_init_kwargs(ready, FakeModel)["num_bands"], 8)


if __name__ == "__main__":
    unittest.main()
