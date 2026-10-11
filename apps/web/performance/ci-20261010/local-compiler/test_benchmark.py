from __future__ import annotations

import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("benchmark.py")
SPEC = importlib.util.spec_from_file_location("local_compiler_benchmark", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot import local compiler benchmark")
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


class CleanSourceAdmissionTests(unittest.TestCase):
    def make_repository(self, root: Path) -> Path:
        repository = root / "repository"
        source = repository / "apps/web"
        source.mkdir(parents=True)
        (source / "fixture.ts").write_text("export const value = 1;\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(repository)], check=True)
        subprocess.run(["git", "-C", str(repository), "add", "apps/web/fixture.ts"], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "-c",
                "user.name=CI Evidence Test",
                "-c",
                "user.email=ci-evidence@example.invalid",
                "commit",
                "-qm",
                "fixture",
            ],
            check=True,
        )
        return repository

    def test_clean_source_is_bound_to_exact_head_and_tree(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-clean-") as root:
            repository = self.make_repository(Path(root))
            head, tree = BENCHMARK.require_clean_measured_source(repository)
            self.assertEqual(len(head), 40)
            self.assertEqual(len(tree), 40)
            self.assertEqual(
                tree,
                subprocess.check_output(
                    ["git", "-C", str(repository), "rev-parse", "HEAD:apps/web"],
                    text=True,
                ).strip(),
            )

    def test_dirty_tracked_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-dirty-") as root:
            repository = self.make_repository(Path(root))
            (repository / "apps/web/fixture.ts").write_text(
                "export const value = 2;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "source is dirty"):
                BENCHMARK.require_clean_measured_source(repository)

    def test_dirty_untracked_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-untracked-") as root:
            repository = self.make_repository(Path(root))
            (repository / "apps/web/untracked.ts").write_text(
                "export const extra = true;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "source is dirty"):
                BENCHMARK.require_clean_measured_source(repository)

    def test_tracked_snapshot_content_tamper_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-snapshot-") as root:
            repository = self.make_repository(Path(root))
            snapshot = Path(root) / "snapshot"
            shutil.copytree(repository / "apps/web", snapshot)
            contract = BENCHMARK.verify_tracked_snapshot(repository, snapshot)
            self.assertEqual(contract["trackedBlobCount"], 1)
            (snapshot / "fixture.ts").write_text(
                "export const value = 3;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "content mismatch"):
                BENCHMARK.verify_tracked_snapshot(repository, snapshot)

    @staticmethod
    def sequence(name: str, duration_ms: float) -> dict[str, object]:
        return {
            "sequence": name,
            "durationMs": duration_ms,
            "success": True,
            "cpuSeconds": duration_ms / 2000,
            "maximumResidentSetBytes": 100_000_000,
            "commands": [
                {
                    "command": command,
                    "durationMs": duration_ms / len(BENCHMARK.SEQUENCES[name]),
                }
                for command in BENCHMARK.SEQUENCES[name]
            ],
        }

    def synthetic_raw(self, aa_difference_ms: float) -> dict[str, object]:
        measured = []
        aa_pairs = []
        for index in range(7):
            measured.append(
                {
                    "runs": [
                        self.sequence("before", 10_000 + index),
                        self.sequence("after", 5_000 + index),
                    ]
                }
            )
            signed = aa_difference_ms if index % 2 == 0 else -aa_difference_ms
            aa_pairs.append(
                {
                    "runs": [
                        self.sequence("aa_a", 5_000 + signed / 2),
                        self.sequence("aa_b", 5_000 - signed / 2),
                    ]
                }
            )
        return {
            "metadata": {
                "sourceContractUnchanged": True,
                "experimentConfig": {
                    "pairs": 7,
                    "aaPairs": 7,
                    "acceptanceBudgets": {
                        "absoluteMeanReductionBootstrap95CiLowerBoundMs": 2_000,
                        "relativeMeanReductionBootstrap95CiLowerBoundPercent": 5,
                        "noiseAaP95AbsoluteRelativeDifferencePercentMaximum": 5,
                        "noiseAaMeanDifference95CiMustIncludeZero": True,
                    },
                },
            },
            "measuredPairs": measured,
            "aaPairs": aa_pairs,
        }

    def test_analysis_admits_only_when_reduction_and_noise_budgets_pass(self) -> None:
        summary = BENCHMARK.analyze(self.synthetic_raw(10))
        self.assertTrue(summary["evidenceAdmission"]["admitted"])
        self.assertTrue(all(summary["evidenceAdmission"]["budgetChecks"].values()))

    def test_analysis_rejects_excessive_aa_noise(self) -> None:
        summary = BENCHMARK.analyze(self.synthetic_raw(2_000))
        self.assertFalse(summary["evidenceAdmission"]["admitted"])
        self.assertFalse(summary["evidenceAdmission"]["budgetChecks"]["noiseP95"])


if __name__ == "__main__":
    unittest.main()
