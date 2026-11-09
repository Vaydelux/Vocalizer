"""Demucs worker contract tests without model weights (CI safe)."""
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


class FakeModel:
    samplerate = 44100
    audio_channels = 2
    sources = ("drums", "bass", "other", "vocals")

    def cpu(self):
        return self

    def eval(self):
        return self


def local_model(signature, repo):
    assert signature == "955717e8" and repo.is_dir()
    assert (repo / DEMUCS_FILENAME).read_bytes() == b"fixture weights"
    return FakeModel()


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

    def test_longer_than_thirty_minutes_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "long.wav"
            source.write_bytes(b"fixture")
            with patch("demucs_service.probe", return_value={
                "streams": [{"codec_type": "audio"}],
                "format": {"duration": "1900"},
            }):
                with self.assertRaises(WorkerError) as exc:
                    separate_demucs(DEMUCS_FILENAME, "missing.th", str(source), folder,
                                    list(FOUR_STEMS), "wav", "cpu", "low-memory", lambda *_: None)
            self.assertEqual(exc.exception.code, "inference-failed")
            self.assertIn("30 minutes", exc.exception.message)

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

    def test_verified_checkpoint_and_bounded_renderer_contract(self):
        demucs = types.ModuleType("demucs")
        pretrained = types.ModuleType("demucs.pretrained")
        pretrained.get_model = local_model
        with tempfile.TemporaryDirectory() as folder:
            input_file = Path(folder) / "input.wav"
            input_file.write_bytes(b"test fixture")
            checkpoint = Path(folder) / DEMUCS_FILENAME
            checkpoint.write_bytes(b"fixture weights")
            output = Path(folder) / "stems"
            output.mkdir()
            result = []
            for stem in FOUR_STEMS:
                target = output / f"{stem}.wav"
                target.write_bytes(b"actual-stem-placeholder")
                result.append({"stem": stem, "path": str(target)})
            with (
                patch.dict(sys.modules, {"demucs": demucs, "demucs.pretrained": pretrained}),
                patch("demucs_service.require_local_demucs_model", return_value=checkpoint),
                patch("demucs_service.probe", return_value={
                    "streams": [{"codec_type": "audio"}],
                    "format": {"duration": "3.0"},
                }),
                patch("demucs_service.render_streaming_stems", return_value=result) as render,
            ):
                stems, model, device, fallback = separate_demucs(
                    DEMUCS_FILENAME, str(checkpoint), str(input_file), str(output),
                    list(FOUR_STEMS), "wav24", "cpu", "balanced", lambda *_: None,
                    mp3_bitrate=128,
                )
            self.assertEqual(stems, result)
            self.assertEqual((model, device, fallback), (DEMUCS_FILENAME, "cpu", False))
            render.assert_called_once()
            kwargs = render.call_args.kwargs
            self.assertEqual(kwargs["input_duration"], 3.0)
            self.assertEqual(kwargs["model"].sources, FakeModel.sources)
            self.assertEqual(kwargs["profile"]["segment"], 7)
            self.assertEqual(kwargs["output_format"], "wav24")
            self.assertEqual(kwargs["chunk_seconds"], 24)
            self.assertEqual(kwargs["mp3_bitrate"], 128)


if __name__ == "__main__":
    unittest.main()
