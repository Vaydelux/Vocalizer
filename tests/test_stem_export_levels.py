"""Check RoFormer audio export levels without downloading models.

These tests protect the audible vocal/instrumental balance: unlike the old
independent peak normalization, the same gain applies to all stem signals.
"""
from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
from errors import WorkerError
from stem_export_levels import shared_pcm_export_gain


class RoformerStemExportLevelsTests(unittest.TestCase):
    def test_silent_and_in_range_stems_are_not_changed(self):
        self.assertEqual(shared_pcm_export_gain([0, 0]), 1.0)
        self.assertEqual(shared_pcm_export_gain([0.1, 0.5]), 1.0)
        self.assertEqual(shared_pcm_export_gain([0.999, 0.1]), 1.0)

    def test_loud_stem_attenuates_all_stems_equally(self):
        # Previous code independently scaled 2.0 and 0.25 to unrelated levels
        # and could make quiet background instruments louder than intended.
        vocal_peak, instrumental_peak = 2.0, 0.25
        gain = shared_pcm_export_gain([vocal_peak, instrumental_peak])
        self.assertAlmostEqual(gain, 0.999 / 2.0)
        exported_vocal = vocal_peak * gain
        exported_instrumental = instrumental_peak * gain
        self.assertLessEqual(exported_vocal, 0.999 + 1e-7)
        self.assertAlmostEqual(exported_vocal / exported_instrumental,
                               vocal_peak / instrumental_peak)

    def test_four_stems_keep_mix_summation_and_relative_levels(self):
        sample_values = {"Vocals": 1.50, "Drums": -0.20,
                         "Bass": 0.35, "Other": 0.15}
        gain = shared_pcm_export_gain(abs(v) for v in sample_values.values())
        exported = {name: v * gain for name, v in sample_values.items()}
        self.assertAlmostEqual(sum(exported.values()),
                               sum(sample_values.values()) * gain)
        for name, value in sample_values.items():
            self.assertAlmostEqual(exported[name], value * gain)
        self.assertLessEqual(max(abs(x) for x in exported.values()), 0.999 + 1e-7)

    def test_nonfinite_negative_and_empty_peaks_are_rejected(self):
        for invalid in (float("nan"), float("inf"), float("-inf"), -0.1):
            with self.subTest(invalid=invalid), self.assertRaises(WorkerError):
                shared_pcm_export_gain([0.25, invalid])
        with self.assertRaises(WorkerError):
            shared_pcm_export_gain([])

    def test_invalid_ceiling_is_rejected(self):
        for invalid in (0, -1, 1, 1.1, float("nan"), float("inf")):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                shared_pcm_export_gain([0.5], invalid)

    def test_gain_does_not_increase_quiet_stems(self):
        for highest in (0.0, 0.01, 0.4, 0.9989, 0.999, 1.0, 2.0, 8.0):
            gain = shared_pcm_export_gain([highest, 0.1])
            self.assertGreater(gain, 0)
            self.assertLessEqual(gain, 1.0)
            self.assertTrue(math.isfinite(gain))


if __name__ == "__main__":
    unittest.main()
