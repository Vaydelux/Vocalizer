"""Regression tests: a missing or invalid model may never trigger downloads."""
from hashlib import sha256
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
from local_model import MODEL_FILENAME, DEMUCS_FILENAME, require_local_mdx_model, require_local_demucs_model
from errors import WorkerError


class LocalModelTests(unittest.TestCase):
    def test_missing_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(WorkerError) as error:
                require_local_mdx_model(MODEL_FILENAME, str(Path(temp) / MODEL_FILENAME))
            self.assertEqual(error.exception.code, "model-not-found")

    def test_relative_path_is_rejected(self):
        with self.assertRaises(WorkerError):
            require_local_mdx_model(MODEL_FILENAME, MODEL_FILENAME)

    def test_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / MODEL_FILENAME
            model.write_bytes(b"invalid")
            with self.assertRaises(WorkerError) as error:
                require_local_mdx_model(MODEL_FILENAME, str(model), expected_size=7)
            self.assertEqual(error.exception.code, "model-corrupted")

    def test_valid_local_model_is_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / MODEL_FILENAME
            model.write_bytes(b"fixture")
            actual = require_local_mdx_model(MODEL_FILENAME, str(model),
                                             expected_size=7,
                                             expected_sha256=sha256(b"fixture").hexdigest())
            self.assertEqual(actual, model.resolve())

    def test_demucs_missing_local_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(WorkerError) as error:
                require_local_demucs_model(DEMUCS_FILENAME, str(Path(folder) / DEMUCS_FILENAME))
            self.assertEqual(error.exception.code, "model-not-found")

    def test_demucs_rejects_unapproved_model_id(self):
        with self.assertRaises(WorkerError) as error:
            require_local_demucs_model("htdemucs.yaml", "/tmp/htdemucs.yaml")
        self.assertEqual(error.exception.code, "architecture-unsupported")

    def test_demucs_rejects_tampered_weights(self):
        with tempfile.TemporaryDirectory() as folder:
            model = Path(folder) / DEMUCS_FILENAME
            model.write_bytes(b"tampered")
            with self.assertRaises(WorkerError) as error:
                require_local_demucs_model(DEMUCS_FILENAME, str(model))
            self.assertEqual(error.exception.code, "model-corrupted")

    def test_demucs_verified_sha256_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            model = Path(folder) / DEMUCS_FILENAME
            model.write_bytes(b"fixture")
            verified = require_local_demucs_model(
                DEMUCS_FILENAME, str(model), expected_sha256=sha256(b"fixture").hexdigest(),
            )
            self.assertEqual(verified, model.resolve())


if __name__ == "__main__":
    unittest.main()
