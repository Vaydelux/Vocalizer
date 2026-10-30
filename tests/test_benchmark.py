"""Offline reproducibility and scoring regression with original synthetic audio."""
from __future__ import annotations
import importlib.util
import math
from pathlib import Path
import sys
import tempfile
import unittest
import wave
from array import array

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "benchmark-separation.py"
spec = importlib.util.spec_from_file_location("vocalizer_benchmark", SCRIPT)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def wav(path: Path, samples: list[int], rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(array("h", samples).tobytes())


class BenchmarkTests(unittest.TestCase):
    def test_reference_scores_and_reconstruction(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            vocals = [round(7000 * math.sin(n * 0.13)) for n in range(4096)]
            instrumental = [round(5000 * math.cos(n * 0.083)) for n in range(4096)]
            mix = [a + b for a, b in zip(vocals, instrumental)]
            for name, samples in [("vocals", vocals), ("instrumental", instrumental), ("mix", mix)]:
                wav(root / (name + ".wav"), samples)
            good = benchmark.compare(root/"vocals.wav", root/"instrumental.wav",
                                     root/"mix.wav",root/"vocals.wav",root/"instrumental.wav")
            swapped = benchmark.compare(root/"instrumental.wav",root/"vocals.wav",
                                        root/"mix.wav",root/"vocals.wav",root/"instrumental.wav")
            self.assertGreater(good["vocals_si_sdr_db"], 100)
            self.assertGreater(good["instrumental_si_sdr_db"], 100)
            self.assertLess(swapped["vocals_si_sdr_db"], 0)
            # Perfect mixture reconstruction does NOT establish separation!
            self.assertEqual(good["mixture_reconstruction_snr_db"], 120.0)
            self.assertEqual(swapped["mixture_reconstruction_snr_db"], 120.0)
            no_reference = benchmark.compare(root/"vocals.wav",root/"instrumental.wav",
                                             root/"mix.wav",None,None)
            self.assertFalse(no_reference["ground_truth_available"])
            self.assertIsNone(no_reference["vocals_si_sdr_db"])

    def test_rejects_unaligned_audio(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d)/"a.wav",Path(d)/"b.wav"
            wav(a,[1,2,3],rate=16000)
            wav(b,[1,2,3],rate=22050)
            with self.assertRaisesRegex(ValueError, "Audio shape mismatch"):
                benchmark.compare(a,b,None,a,b)

    def test_profile_values_and_untrusted_override(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"inference"/"worker"))
        from inference_profiles import resolve_profile
        from errors import WorkerError
        self.assertEqual(resolve_profile("low-memory")["segment_size"],128)
        self.assertEqual(resolve_profile("balanced")["segment_size"],256)
        self.assertEqual(resolve_profile("thorough")["overlap"],0.5)
        self.assertEqual(resolve_profile("low-memory",256)["segment_size"],256)
        with self.assertRaises(WorkerError):
            resolve_profile("thorough",512)
        with self.assertRaises(WorkerError):
            resolve_profile("turbo")
        with self.assertRaises(WorkerError):
            resolve_profile("balanced",True)


if __name__ == "__main__":
    unittest.main()
