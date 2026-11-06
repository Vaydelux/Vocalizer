
"""Demucs offline service contract tests (no model weights required for CI)."""
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))

from demucs_service import FOUR_STEMS, separate_demucs
from errors import WorkerError
from local_model import DEMUCS_FILENAME


class FakeTensor:
    def detach(self):
        return self

    def cpu(self):
        return self


class FakeSeparator:
    samplerate = 44100

    def __init__(self, **kwargs):
        if kwargs["model"] != "955717e8" or kwargs["device"] != "cpu" or kwargs["repo"] is None:
            raise AssertionError("Demucs must use the pinned local model and CPU.")

    def separate_audio_file(self, path):
        return FakeTensor(), {stem.lower(): FakeTensor() for stem in FOUR_STEMS}


def fake_save_audio(tensor, path, samplerate, **kwargs):
    assert samplerate == 44100
    Path(path).write_bytes(b"real audio fixture stub")


class OfflineDemucsTests(unittest.TestCase):
    def test_rejects_invalid_stem_selection_without_importing_model(self):
        with self.assertRaises(WorkerError) as error:
            separate_demucs(DEMUCS_FILENAME, "missing.th", "x.wav", "out",
                            ["Vocals", "Drums"], "wav", "cpu", "balanced", lambda *_: None)
        self.assertEqual(error.exception.code, "architecture-unsupported")

    def test_rejects_gpu_without_importing_model(self):
        with self.assertRaises(WorkerError) as error:
            separate_demucs(DEMUCS_FILENAME, "missing.th", "x.wav", "out",
                            list(FOUR_STEMS), "wav", "cuda", "balanced", lambda *_: None)
        self.assertEqual(error.exception.code, "device-unsupported")

    def test_offline_local_model_uses_all_four_outputs(self):
        demucs = types.ModuleType("demucs")
        api = types.ModuleType("demucs.api")
        audio = types.ModuleType("demucs.audio")
        api.Separator = FakeSeparator
        audio.save_audio = fake_save_audio
        with tempfile.TemporaryDirectory() as folder:
            fake_checkpoint = Path(folder) / DEMUCS_FILENAME
            fake_checkpoint.write_bytes(b"fixture")
            out = Path(folder) / "output"
            progress = []
            with (
                patch.dict(sys.modules, {"demucs": demucs, "demucs.api": api, "demucs.audio": audio}),
                patch("demucs_service.require_local_demucs_model", return_value=fake_checkpoint),
                patch("demucs_service.verify_audio_file", side_effect=lambda p: self.assertTrue(Path(p).is_file())),
            ):
                stems, model, device, fallback = separate_demucs(
                    DEMUCS_FILENAME, str(fake_checkpoint), "input.wav", str(out),
                    list(FOUR_STEMS), "wav24", "cpu", "balanced",
                    lambda value, stage: progress.append((value, stage)),
                )
            self.assertEqual([x["stem"] for x in stems], list(FOUR_STEMS))
            self.assertTrue(all(Path(x["path"]).is_file() for x in stems))
            self.assertEqual((model, device, fallback), (DEMUCS_FILENAME, "cpu", False))
            self.assertEqual(progress[-1], (1.0, "Completed"))


if __name__ == "__main__":
    unittest.main()
