"""Regression tests for probed stem metadata and safety checks."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))

from audio_validation import verify_audio_file
from errors import WorkerError


def fixture(rate="44100", channels=2, duration="3.00"):
    return {
        "streams": [{
            "codec_type": "audio",
            "sample_rate": rate,
            "channels": channels,
            "duration": duration,
        }],
        "format": {"duration": duration},
    }


class AudioValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "stem.wav"
        self.path.write_bytes(b"nonempty test fixture")

    def assert_rejected(self, result, **kwargs):
        with patch("audio_validation.probe", return_value=result):
            with self.assertRaises(WorkerError) as error:
                verify_audio_file(str(self.path), **kwargs)
        self.assertEqual(error.exception.code, "encoding-failed")

    def test_measured_duration_rate_channels_accepted(self):
        with patch("audio_validation.probe", return_value=fixture()):
            verify_audio_file(str(self.path), expected_duration=3.0,
                              expected_sample_rate=44100, expected_channels=2)

    def test_duration_mismatch_is_rejected(self):
        self.assert_rejected(fixture(duration="2.1"), expected_duration=3.0)

    def test_sample_rate_mismatch_is_rejected(self):
        self.assert_rejected(fixture(rate="48000"), expected_sample_rate=44100)

    def test_channel_mismatch_is_rejected(self):
        self.assert_rejected(fixture(channels=1), expected_channels=2)

    def test_no_audio_stream_is_rejected(self):
        self.assert_rejected({"streams": [{"codec_type": "video"}], "format": {"duration": "3"}})

    def test_non_finite_duration_is_rejected(self):
        self.assert_rejected(fixture(duration="nan"))

    def test_empty_file_is_rejected_before_probing(self):
        self.path.write_bytes(b"")
        with self.assertRaises(WorkerError):
            verify_audio_file(str(self.path))


if __name__ == "__main__":
    unittest.main()
