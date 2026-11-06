"""Keep optional MDX dependencies isolated from four-stem worker import/dispatch."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))

from separator_service import SeparatorService


class WorkerDispatchTests(unittest.TestCase):
    def test_demucs_dispatch_does_not_require_mdx_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            input_path = Path(folder) / "source.wav"
            input_path.write_bytes(b"input")
            expected = ([{"stem": "Vocals", "path": str(input_path)}], "pinned", "cpu", False)
            with patch("demucs_service.separate_demucs", return_value=expected) as demucs:
                actual = SeparatorService().separate(
                    model_id="pinned", model_path="checkpoint.th",
                    architecture="demucs", config_path=None,
                    input_path=str(input_path), output_dir=folder,
                    requested_stems=["Vocals", "Drums", "Bass", "Other"],
                    output_format="wav", device="cpu", on_progress=lambda *_: None,
                    profile="balanced",
                )
            self.assertEqual(actual, expected)
            demucs.assert_called_once()


if __name__ == "__main__":
    unittest.main()
