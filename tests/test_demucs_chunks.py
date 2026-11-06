"""Pure-Python tests for bounded, sample-accurate window planning."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
from demucs_chunks import plan_chunks


class DemucsChunkPlannerTests(unittest.TestCase):
    def test_short_source_is_one_window(self):
        windows, fade = plan_chunks(3 * 44100, 44100)
        self.assertEqual(len(windows), 1)
        self.assertEqual((windows[0].core_start, windows[0].core_stop), (0, 3 * 44100))
        self.assertEqual(fade, 11025)

    def test_more_than_ten_minutes_is_bounded(self):
        sr = 44100
        total = 16 * 60 * sr + 7
        chunks, fade = plan_chunks(total, sr)
        self.assertGreater(len(chunks), 40)
        self.assertEqual(chunks[0].core_start, 0)
        self.assertEqual(chunks[-1].core_stop, total)
        self.assertTrue(all(c.decode_stop - c.decode_start <= 30 * sr for c in chunks))
        self.assertTrue(all(a.core_stop - b.core_start == fade for a, b in zip(chunks, chunks[1:])))
        reconstructed = sum(c.core_frames for c in chunks) - fade * (len(chunks) - 1)
        self.assertEqual(reconstructed, total)

    def test_boundary_is_not_duplicated(self):
        sr = 100
        for size in (2400, 2401, 2402, 2424, 2449, 4800, 4849, 10000):
            chunks, fade = plan_chunks(size, sr)
            samples_written = sum(c.core_frames for c in chunks) - fade * (len(chunks) - 1)
            self.assertEqual(samples_written, size)

    def test_context_does_not_change_core_alignment(self):
        chunks, _ = plan_chunks(9000, 100, core_seconds=12,
                                context_seconds=2, crossfade_seconds=.3)
        for c in chunks:
            self.assertLessEqual(c.decode_start, c.core_start)
            self.assertGreaterEqual(c.decode_stop, c.core_stop)
            self.assertEqual(c.offset_frames, c.core_start - c.decode_start)

    def test_bad_settings_are_rejected(self):
        for config in [
            (-1, 100),
            (1, 0),
        ]:
            with self.assertRaises(ValueError):
                plan_chunks(*config)
        for kwargs in [
            {"crossfade_seconds": 0},
            {"context_seconds": 0.05, "crossfade_seconds": 0.25},
            {"core_seconds": 0.1, "crossfade_seconds": 0.25},
            {"core_seconds": float("inf")},
        ]:
            with self.assertRaises(ValueError):
                plan_chunks(5000, 100, **kwargs)


if __name__ == "__main__":
    unittest.main()
