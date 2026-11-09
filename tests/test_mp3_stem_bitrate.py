"""Model-free tests for secure MP3 stem bitrate forwarding."""
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))

from audio_encoding_options import require_mp3_bitrate, stem_codec_args
from errors import WorkerError
from separator_service import SeparatorService


class Mp3StemBitrateTests(unittest.TestCase):
    def test_supported_rates_build_correct_ffmpeg_arguments(self):
        for rate in (128, 192, 256, 320):
            codec = stem_codec_args("mp3", rate)
            self.assertEqual(codec, ["-c:a", "libmp3lame", "-b:a", f"{rate}k"])
        self.assertEqual(stem_codec_args("mp3"), [
            "-c:a", "libmp3lame", "-b:a", "320k",
        ])
        self.assertNotIn("-b:a", stem_codec_args("wav24", 320))

    def test_malformed_bitrates_are_rejected_even_without_electron(self):
        for invalid in (-1, 0, 96, 160, 999, float("nan"), float("inf"), "320", True, None):
            with self.subTest(invalid=invalid):
                with self.assertRaises(WorkerError) as result:
                    require_mp3_bitrate(invalid)
                self.assertEqual(result.exception.code, "encoding-failed")

    def test_demucs_dispatch_receives_selected_bitrate(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.wav"
            source.write_bytes(b"synthetic audio placeholder")
            result = ([], "demucs", "cpu", False)
            with patch("demucs_service.separate_demucs", return_value=result) as separate:
                actual = SeparatorService().separate(
                    model_id="local", model_path="checkpoint.th", architecture="demucs",
                    config_path=None, input_path=str(source), output_dir=directory,
                    requested_stems=["Vocals", "Drums", "Bass", "Other"],
                    output_format="mp3", device="cpu", on_progress=lambda *_: None,
                    mp3_bitrate=128,
                )
            self.assertEqual(actual, result)
            self.assertEqual(separate.call_args.kwargs["mp3_bitrate"], 128)

    def test_mdx_separator_uses_per_job_rate_and_distinct_cache_key(self):
        class FakeSeparator:
            instances = []

            def __init__(self, **kwargs):
                self.options = kwargs
                self.__class__.instances.append(self)

            def load_model(self, filename):
                self.filename = filename

            def separate(self, input_path):
                output_dir = Path(self.options["output_dir"])
                names = ["fixture_(Vocals).mp3", "fixture_(Instrumental).mp3"]
                for name in names:
                    (output_dir / name).write_bytes(b"fake separated audio")
                return names

        fake_package = types.ModuleType("audio_separator")
        fake_package.__path__ = []
        fake_module = types.ModuleType("audio_separator.separator")
        fake_module.Separator = FakeSeparator

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.wav"
            source.write_bytes(b"synthetic source")
            model = Path(directory) / "local.onnx"
            model.write_bytes(b"mocked checkpoint")
            service = SeparatorService()
            with (
                patch.dict(sys.modules, {
                    "audio_separator": fake_package,
                    "audio_separator.separator": fake_module,
                }),
                patch("separator_service.require_local_mdx_model", return_value=model),
                patch("separator_service.match_stems", return_value=["Vocals", "Instrumental"]),
                patch("separator_service.verify_audio_file", return_value=None),
            ):
                for rate in (128, 320):
                    stems, _, _, _ = service.separate(
                        model_id="local", model_path=str(model), architecture="mdx-net",
                        config_path=None, input_path=str(source), output_dir=directory,
                        requested_stems=["Vocals", "Instrumental"],
                        output_format="mp3", device="cpu", on_progress=lambda *_: None,
                        mp3_bitrate=rate,
                    )
                    self.assertEqual({entry["stem"] for entry in stems}, {
                        "Vocals", "Instrumental",
                    })
            self.assertEqual([instance.options["output_bitrate"]
                              for instance in FakeSeparator.instances], ["128k", "320k"])
            self.assertEqual(len(service._separators), 2)


if __name__ == "__main__":
    unittest.main()
