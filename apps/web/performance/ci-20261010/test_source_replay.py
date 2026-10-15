from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[3]
PROOF = json.loads((ROOT / "source-replay-validation.json").read_text(encoding="utf-8"))
EVIDENCE_FILES = (
    "collection.json",
    "excluded-observations.json",
    "report.md",
    "successful-runs.json",
    "summary.json",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replay(script: Path, output: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            str(script),
            "--input-dir",
            str(ROOT),
            "--output-dir",
            str(output),
        ],
        cwd=REPOSITORY,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


class SourceReplayTests(unittest.TestCase):
    def test_historical_and_current_sources_replay_retained_inputs(self) -> None:
        historical = (
            ROOT
            / "historical-collector-380c6e3f/.github/scripts/collect-ci-performance.py"
        )
        current = REPOSITORY / ".github/scripts/collect-ci-performance.py"
        self.assertEqual(sha256(historical), PROOF["historicalSource"]["sha256"])
        self.assertEqual(sha256(current), PROOF["currentSource"]["sha256"])

        with tempfile.TemporaryDirectory(prefix="tzudong-ci-source-replay-") as temp:
            temp_root = Path(temp)
            historical_output = temp_root / "historical"
            current_output = temp_root / "current"
            replay(historical, historical_output)
            replay(current, current_output)

            for name in EVIDENCE_FILES:
                expected = PROOF["replayedOutputs"][name]
                self.assertEqual(sha256(ROOT / name), expected)
                self.assertEqual(sha256(historical_output / name), expected)
                self.assertEqual(sha256(current_output / name), expected)

            for name in (*EVIDENCE_FILES, "artifact-map.json", "artifact-map.json.sha256"):
                self.assertEqual(
                    (historical_output / name).read_bytes(),
                    (ROOT / name).read_bytes(),
                )
            self.assertEqual(
                sha256(historical_output / "artifact-map.json"),
                PROOF["historicalSource"]["replayedArtifactMapSha256"],
            )
            self.assertEqual(
                (current_output / "artifact-map.json").read_bytes(),
                (ROOT / "artifact-map-current-source.json").read_bytes(),
            )
            self.assertEqual(
                sha256(current_output / "artifact-map.json"),
                PROOF["currentSource"]["replayedArtifactMapSha256"],
            )


if __name__ == "__main__":
    unittest.main()
