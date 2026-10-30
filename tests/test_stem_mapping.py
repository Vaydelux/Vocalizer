"""Regression tests for strict mapping of real separation filenames."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
from errors import WorkerError
from stem_mapping import match_stems

REQUESTED = ["Vocals", "Instrumental"]


class StemMappingTests(unittest.TestCase):
    def test_accepts_real_two_stem_names(self):
        self.assertEqual(
            match_stems(["song_(Vocals)_model.wav", "song_(Instrumental)_model.wav"], REQUESTED),
            REQUESTED,
        )

    def test_duplicate_stems_are_rejected(self):
        with self.assertRaises(WorkerError):
            match_stems(["x_(Vocals)_1.wav", "x_(Vocals)_2.wav"], REQUESTED)

    def test_unknown_stem_is_rejected(self):
        with self.assertRaises(WorkerError):
            match_stems(["x_(Vocals).wav", "unknown.wav"], REQUESTED)

    def test_ambiguous_stem_is_rejected(self):
        with self.assertRaises(WorkerError):
            match_stems(["x_(Vocals)_(Instrumental).wav", "x_(Instrumental).wav"], REQUESTED)

    def test_missing_file_is_rejected(self):
        with self.assertRaises(WorkerError):
            match_stems(["x_(Vocals).wav"], REQUESTED)

    def test_unsupported_stem_set_is_rejected(self):
        with self.assertRaises(WorkerError):
            match_stems(["x_(Vocals).wav", "x_(Drums).wav"], ["Vocals", "Drums"])


if __name__ == "__main__":
    unittest.main()
