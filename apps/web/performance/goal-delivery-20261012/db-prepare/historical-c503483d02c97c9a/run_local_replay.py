#!/usr/bin/env python3
"""Replay the exact protected-main targeted DB tests in an isolated archive."""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
COMMIT = "056a86600f412eb42df4304e3206841679012f3e"
TREE = "4b47fe832c375a9a0f829332c354379c042ace06"
PG_BIN = Path("/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6/installed/bin")
MODULES = [
    "backend.supabase.tests.test_review_media_commit_cleanup",
    "backend.supabase.tests.test_review_media_catalog_integration",
    "backend.supabase.tests.test_admin_evaluation_revision_safeupdate",
    "backend.supabase.tests.test_admin_record_expired_preview_readback",
    "backend.supabase.tests.test_admin_verification_durable_staging",
    "backend.supabase.tests.test_review_storage_retirement_contract",
    "backend.supabase.tests.test_review_storage_pg15_replay",
]


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main() -> None:
    if git("rev-parse", "origin/main").decode().strip() != COMMIT:
        raise SystemExit("local replay refused: origin/main moved")
    if git("rev-parse", f"{COMMIT}^{{tree}}").decode().strip() != TREE:
        raise SystemExit("local replay refused: tree mismatch")
    if not (PG_BIN / "postgres").is_file():
        raise SystemExit("local replay refused: pinned PostgreSQL binary unavailable")

    archive = git("archive", COMMIT)
    with tempfile.TemporaryDirectory(prefix="tzudong-main-replay-") as temporary:
        checkout = Path(temporary)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
            members = bundle.getmembers()
            if any(Path(member.name).is_absolute() or ".." in Path(member.name).parts for member in members):
                raise SystemExit("local replay refused: unsafe Git archive member")
            bundle.extractall(checkout)
        environment = os.environ.copy()
        environment.update(
            REVIEW_TEST_PG_BIN=str(PG_BIN),
            REVIEW_TEST_PG_VERSION="17.6",
        )
        started = time.monotonic()
        result = subprocess.run(
            ["python3", "-m", "unittest", *MODULES],
            cwd=checkout,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )
        elapsed = time.monotonic() - started

    combined = result.stdout + result.stderr
    match = re.search(r"Ran (\d+) tests in ([0-9.]+)s", combined)
    if result.returncode or not match or not re.search(r"(?m)^OK$", combined):
        raise SystemExit("local replay failed; inspect the test process directly")
    receipt = {
        "schemaVersion": 1,
        "status": "passed",
        "source": {"commit": COMMIT, "tree": TREE, "archive": "git archive exact commit"},
        "runtime": {
            "postgres": subprocess.check_output(
                [str(PG_BIN / "postgres"), "--version"], text=True
            ).strip(),
            "network": "none required by selected suite",
            "hostedReads": 0,
            "hostedWrites": 0,
            "storageWrites": 0,
            "providerCalls": 0,
        },
        "suite": {
            "modules": MODULES,
            "testsRun": int(match.group(1)),
            "failures": 0,
            "errors": 0,
            "skips": 0,
            "reportedSeconds": float(match.group(2)),
            "wallSeconds": round(elapsed, 6),
        },
        "scope": {
            "proves": [
                "target source contracts",
                "review media catalog integration",
                "rollback and permission checks covered by the selected tests",
                "PG17.6 compatibility exercised by the integration fixture",
            ],
            "doesNotProve": [
                "hosted prior state",
                "one-transaction replay of all 11 migrations",
                "writer-fence freshness",
                "hosted terminal readback",
                "deployment readiness",
            ],
        },
    }
    destination = HERE / "local-replay-v1.json"
    destination.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "tests": int(match.group(1)), "path": str(destination)}))


if __name__ == "__main__":
    main()
