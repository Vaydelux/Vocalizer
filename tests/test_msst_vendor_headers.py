"""Regression guard for vendored MSST RoFormer importable source headers.

The initial copy embedded literal backslash-n characters inside the license
comment and accidentally commented out the first functools imports. AST checks
need no torch/model downloads, and fail source CI before Windows packaging.
"""
from __future__ import annotations

import ast
from pathlib import Path
import unittest


MSST_ROOT = Path(__file__).resolve().parents[1] / "inference" / "worker" / "msst_roformer"


class MSSTVendorHeaderTests(unittest.TestCase):
    def test_license_headers_have_real_newlines_and_required_imports(self):
        for source, import_name in [
            ("attend.py", "wraps"),
            ("bs_roformer.py", "partial"),
            ("mel_band_roformer.py", "partial"),
        ]:
            with self.subTest(source=source):
                content = (MSST_ROOT / source).read_text(encoding="utf-8")
                lines = content.splitlines()
                self.assertTrue(lines[0].startswith("# MIT-licensed"))
                self.assertTrue(lines[1].startswith("# Original copyright"))
                self.assertNotIn(r"\n", lines[0])
                self.assertNotIn(r"\n", lines[1])
                tree = ast.parse(content)
                imports = {
                    alias.name
                    for node in tree.body
                    if isinstance(node, ast.ImportFrom) and node.module == "functools"
                    for alias in node.names
                }
                self.assertIn(import_name, imports)

    def test_vendor_modules_stay_syntax_valid(self):
        for file in MSST_ROOT.glob("*.py"):
            with self.subTest(file=file.name):
                ast.parse(file.read_text(encoding="utf-8"), filename=str(file))


if __name__ == "__main__":
    unittest.main()
