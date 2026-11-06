"""Standalone 24-bit stereo boundary metric tests; no model download."""
import math
from pathlib import Path
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from demucs_acceptance_metrics import pcm24_step_at_frame, seam_step_metrics


def make_wav(path: Path, jump_at: int | None, seconds: int = 9, rate: int = 100):
    data = bytearray()
    for n in range(seconds * rate):
        value = 5000000 if jump_at is not None and n >= jump_at else 0
        sample = value.to_bytes(3, "little", signed=True)
        data.extend(sample + sample)
    with wave.open(str(path), "wb") as output:
        output.setframerate(rate)
        output.setnchannels(2)
        output.setsampwidth(3)
        output.writeframes(data)


class BoundaryMetricsTests(unittest.TestCase):
    def test_silence_is_near_negative_infinity_and_not_nan(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "quiet.wav"
            make_wav(f, None)
            value = pcm24_step_at_frame(f, 800)
            self.assertEqual(value, 0)
            result = seam_step_metrics(f, seconds=9, rate=100)
            self.assertEqual(result["crossfade_boundaries"], 2)
            self.assertTrue(math.isfinite(result["max_near_seam_step_dbfs"]))

    def test_detects_discontinuity_at_crossfade_end(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "click.wav"
            make_wav(f, 800)
            measured = pcm24_step_at_frame(f, 800)
            self.assertAlmostEqual(measured, 5000000 / (2**23))
            summary = seam_step_metrics(f, seconds=9, rate=100)
            self.assertGreater(summary["max_near_seam_step_dbfs"], -5)

    def test_rejects_out_of_bounds_seam(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "short.wav"
            make_wav(f, None, seconds=3)
            with self.assertRaises(ValueError):
                pcm24_step_at_frame(f, 300)

    def test_one_window_reports_no_seam(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "single.wav"
            make_wav(f, None, seconds=3)
            self.assertEqual(seam_step_metrics(f, seconds=3, rate=100), {
                "crossfade_boundaries": 0, "max_near_seam_step_dbfs": None,
            })


if __name__ == "__main__":
    unittest.main()
