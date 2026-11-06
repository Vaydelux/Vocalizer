"""Demucs 4.0.1 offline worker contract tests without bundled model weights."""
from contextlib import nullcontext
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
    ndim = 2
    shape = (2, 132300)

    def mean(self, *_):
        return self

    def std(self):
        return self

    def clamp(self, **_):
        return self

    def __sub__(self, _):
        return self

    def __truediv__(self, _):
        return self

    def __mul__(self, _):
        return self

    def __add__(self, _):
        return self

    def __getitem__(self, _):
        return self

    def detach(self):
        return self

    def cpu(self):
        return self


class FakeModel:
    samplerate = 44100
    audio_channels = 2
    sources = ("drums", "bass", "other", "vocals")

    def cpu(self):
        return self

    def eval(self):
        return self


class FakeAudio:
    def __init__(self, path):
        self.path = path

    def read(self, streams, samplerate, channels):
        assert (streams, samplerate, channels) == (0, 44100, 2)
        return FakeTensor()


class FakeBoolean:
    def all(self):
        return True


def local_model(signature, repo):
    assert signature == "955717e8" and repo.is_dir()
    assert (repo / DEMUCS_FILENAME).read_bytes() == b"fixture weights"
    return FakeModel()


def run_model(model, mix, **options):
    assert options["device"] == "cpu" and options["num_workers"] == 0
    assert options["split"] is True and options["segment"] == 7
    return FakeTensor()


def save_audio(tensor, path, samplerate, **kwargs):
    assert samplerate == 44100
    Path(path).write_bytes(b"mock-test-only-audio")


class DemucsServiceTests(unittest.TestCase):
    def test_wrong_stems_rejected(self):
        with self.assertRaises(WorkerError) as exc:
            separate_demucs(DEMUCS_FILENAME, "missing.th", "file.wav", "out",
                            ["Vocals"], "wav", "cpu", "balanced", lambda *_: None)
        self.assertEqual(exc.exception.code, "architecture-unsupported")

    def test_gpu_rejected(self):
        with self.assertRaises(WorkerError) as exc:
            separate_demucs(DEMUCS_FILENAME, "missing.th", "file.wav", "out",
                            list(FOUR_STEMS), "wav", "cuda", "balanced", lambda *_: None)
        self.assertEqual(exc.exception.code, "device-unsupported")

    def test_oversized_recording_fails_before_loading_model(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "long.wav"
            source.write_bytes(b"fixture")
            with patch("demucs_service.probe", return_value={
                "streams": [{"codec_type": "audio"}],
                "format": {"duration": "1000"},
            }):
                with self.assertRaises(WorkerError) as exc:
                    separate_demucs(DEMUCS_FILENAME, "missing.th", str(source), folder,
                                    list(FOUR_STEMS), "wav", "cpu", "low-memory", lambda *_: None)
            self.assertEqual(exc.exception.code, "inference-failed")
            self.assertIn("10 minutes", exc.exception.message)

    def test_invalid_audio_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "invalid.wav"
            source.write_bytes(b"fixture")
            with patch("demucs_service.probe", return_value={
                "streams": [{"codec_type": "video"}], "format": {"duration": "5"},
            }):
                with self.assertRaises(WorkerError) as exc:
                    separate_demucs(DEMUCS_FILENAME, "missing.th", str(source), folder,
                                    list(FOUR_STEMS), "wav", "cpu", "low-memory", lambda *_: None)
            self.assertEqual(exc.exception.code, "inference-failed")

    def test_real_api_contract_and_four_output_validation(self):
        torch = types.ModuleType("torch")
        torch.no_grad = nullcontext
        torch.isfinite = lambda tensor: FakeBoolean()
        demucs = types.ModuleType("demucs")
        pretrained = types.ModuleType("demucs.pretrained")
        apply = types.ModuleType("demucs.apply")
        audio = types.ModuleType("demucs.audio")
        pretrained.get_model = local_model
        apply.apply_model = run_model
        audio.AudioFile = FakeAudio
        audio.save_audio = save_audio

        with tempfile.TemporaryDirectory() as folder:
            input_file = Path(folder) / "input.wav"
            input_file.write_bytes(b"input fixture")
            model_file = Path(folder) / DEMUCS_FILENAME
            model_file.write_bytes(b"fixture weights")
            output = Path(folder) / "stems"
            progress = []
            with (
                patch.dict(sys.modules, {"torch": torch, "demucs": demucs,
                                         "demucs.pretrained": pretrained,
                                         "demucs.apply": apply,
                                         "demucs.audio": audio}),
                patch("demucs_service.require_local_demucs_model", return_value=model_file),
                patch("demucs_service.probe", return_value={
                    "streams": [{"codec_type": "audio"}],
                    "format": {"duration": "3.0"},
                }),
                patch("demucs_service.verify_audio_file", side_effect=lambda p, **kwargs: (
                    self.assertTrue(Path(p).is_file()),
                    self.assertEqual(kwargs["expected_channels"], 2),
                    self.assertEqual(kwargs["expected_sample_rate"], 44100),
                    self.assertAlmostEqual(kwargs["expected_duration"], 3.0),
                )),
            ):
                stems, model, device, fallback = separate_demucs(
                    DEMUCS_FILENAME, str(model_file), str(input_file), str(output),
                    list(FOUR_STEMS), "wav24", "cpu", "balanced",
                    lambda value, stage: progress.append((value, stage)),
                )
            self.assertEqual([s["stem"] for s in stems], list(FOUR_STEMS))
            self.assertTrue(all(Path(s["path"]).is_file() for s in stems))
            self.assertEqual((model, device, fallback), (DEMUCS_FILENAME, "cpu", False))
            self.assertEqual(progress[-1], (1.0, "Completed"))


if __name__ == "__main__":
    unittest.main()
