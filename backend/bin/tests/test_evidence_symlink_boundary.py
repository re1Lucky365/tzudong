"""Unmapped directory/file/broken links must fail before evidence or network admission."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = [
    ("verify_census_complete_v7.py", "apps/web/performance/tzuyang-review-census-20261009/checkpoint-complete-v7", "CENSUS_SYMLINK_DENIED"),
    ("verify_census_field_evidence_v1.py", "apps/web/performance/tzuyang-review-census-20261009/checkpoint-v1", "EVIDENCE_SYMLINK_DENIED"),
    ("verify_user_readiness_integrated_map.py", "apps/web/performance/user-readiness-20261009", "READINESS_SYMLINK_DENIED"),
]


class EvidenceSymlinkBoundaryTests(unittest.TestCase):
    def test_every_backend_verifier_rejects_unmapped_links_before_reading_a_map(self):
        for name, package, code in SCRIPTS:
            for kind in ["file", "directory", "broken", "root"]:
                with self.subTest(verifier=name, kind=kind), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp).resolve()
                    script = root / "backend/bin" / name
                    script.parent.mkdir(parents=True)
                    shutil.copyfile(REPO / "backend/bin" / name, script)
                    target = root / "external"
                    target.mkdir()
                    (target / "fixture.txt").write_text("fixture")
                    base = root / package
                    base.parent.mkdir(parents=True, exist_ok=True)
                    if kind == "root":
                        base.symlink_to(target, target_is_directory=True)
                    else:
                        base.mkdir()
                        link_target = target if kind == "directory" else target / ("missing" if kind == "broken" else "fixture.txt")
                        (base / "unmapped-link").symlink_to(link_target, target_is_directory=kind == "directory")
                    completed = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
                    self.assertNotEqual(completed.returncode, 0)
                    self.assertIn(code, completed.stdout + completed.stderr)

    def test_remote_verifier_rejects_links_before_any_github_request(self):
        script = REPO / "apps/web/performance/readiness-delivery-20261011/verify_remote_evidence_v1.py"
        spec = importlib.util.spec_from_file_location("remote_evidence_fixture", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for kind in ["file", "directory", "broken", "parent"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp).resolve()
                first = next(iter(module.PACKAGES))
                base = root / first
                base.mkdir(parents=True)
                external = root / "external"
                external.mkdir()
                (external / "fixture.txt").write_text("fixture")
                if kind == "parent":
                    base.rmdir()
                    base.parent.rmdir()
                    base.parent.symlink_to(external, target_is_directory=True)
                else:
                    target = external if kind == "directory" else external / ("missing" if kind == "broken" else "fixture.txt")
                    (base / "unmapped-link").symlink_to(target, target_is_directory=kind == "directory")
                with patch.object(module.subprocess, "run", side_effect=AssertionError("network must not run")) as request:
                    with self.assertRaisesRegex(ValueError, "ARTIFACT_SYMLINK_DENIED"):
                        module.verify(root, "0" * 40, "twoimo/tzudong", {"packages": []})
                    request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
