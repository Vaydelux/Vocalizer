"""Regression tests for cancellation request ownership and protocol responses.

Uses the real Python parent handler without importing heavy inference packages.
"""
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference" / "worker"))
import main  # noqa: E402


class FakeRunner:
    def __init__(self, request_id="job-1", active=True, result=True):
        self.request_id = request_id
        self.active = active
        self.result = result
        self.write_lock = threading.Lock()
        self.cancel_calls = 0

    def cancel(self):
        self.cancel_calls += 1
        return self.result


class CancelTests(unittest.TestCase):
    def test_stale_job_id_cannot_interrupt_current_job(self):
        runner = FakeRunner()
        responses = []
        with patch.object(main, "runner", runner), patch.object(main, "emit", responses.append):
            main.handle_cancel({"type": "cancel", "requestId": "old-job"})
        self.assertEqual(runner.cancel_calls, 0)
        self.assertEqual(responses[0]["code"], "unknown")
        self.assertEqual(responses[0]["requestId"], "old-job")

    def test_matching_job_id_cancels_and_reports_cancelled(self):
        runner = FakeRunner()
        responses = []
        with patch.object(main, "runner", runner), patch.object(main, "emit", responses.append):
            main.handle_cancel({"type": "cancel", "requestId": "job-1"})
        self.assertEqual(runner.cancel_calls, 1)
        self.assertEqual(responses[0]["code"], "cancelled")
        self.assertEqual(responses[0]["requestId"], "job-1")

    def test_failed_stream_removes_partial_float_but_preserves_existing(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path(folder) / "htdemucs_(Vocals).wav"
            scratch = Path(folder) / "htdemucs_(Vocals).float.wav"
            original.write_bytes(b"user-owned")
            scratch.write_bytes(b"half-written")
            runner = main.JobRunner()
            runner.output_dir = folder
            runner.pre_existing = {original.name}
            runner.request_id = "broken-job"
            runner.result_paths = set()
            runner._job_file = None

            class ExitedChild:
                def wait(self):
                    return 1

            runner.proc = ExitedChild()
            runner.finish(lambda *_: None)
            self.assertTrue(original.exists())
            self.assertEqual(original.read_bytes(), b"user-owned")
            self.assertFalse(scratch.exists())

    def test_successful_child_keeps_reported_completed_output(self):
        with tempfile.TemporaryDirectory() as folder:
            result = Path(folder) / "htdemucs_(Vocals).wav"
            result.write_bytes(b"completed")
            runner = main.JobRunner()
            runner.output_dir = folder
            runner.pre_existing = set()
            runner.result_paths = {str(result)}
            runner._job_file = None

            class ExitedChild:
                def wait(self):
                    return 0

            runner.proc = ExitedChild()
            runner.finish(lambda *_: None)
            self.assertTrue(result.exists())

    def test_no_active_job_returns_unknown(self):
        runner = FakeRunner(active=False)
        responses = []
        with patch.object(main, "runner", runner), patch.object(main, "emit", responses.append):
            main.handle_cancel({"type": "cancel", "requestId": "job-1"})
        self.assertEqual(runner.cancel_calls, 0)
        self.assertEqual(responses[0]["code"], "unknown")


if __name__ == "__main__":
    unittest.main()
