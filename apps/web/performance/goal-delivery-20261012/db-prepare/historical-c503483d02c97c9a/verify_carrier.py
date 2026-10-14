#!/usr/bin/env python3
"""Fail closed when the review carrier drifts from protected main."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import build_carrier


ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
CARRIER = HERE / "review-carrier-v1.json"


def git(*args: str, binary: bool = False) -> str | bytes:
    value = subprocess.check_output(["git", *args], cwd=ROOT)
    return value if binary else value.decode().strip()


def fail(message: str) -> None:
    raise SystemExit(f"carrier verification failed: {message}")


def main() -> None:
    carrier = json.loads(CARRIER.read_text())
    protected = carrier["protectedSource"]
    if git("rev-parse", "origin/main") != protected["commit"]:
        fail("origin/main moved")
    if git("rev-parse", f"{protected['commit']}^{{tree}}") != protected["tree"]:
        fail("tree mismatch")

    versions: list[str] = []
    paths: set[str] = set()
    with tempfile.TemporaryDirectory(prefix="tzudong-db-carrier-verify-") as temporary:
        temp_root = Path(temporary)
        parser = temp_root / Path(build_carrier.PARSER_PATH).name
        parser.write_bytes(git("show", f"{protected['commit']}:{build_carrier.PARSER_PATH}", binary=True))
        for migration in carrier["migrations"]:
            path = migration["path"]
            raw = git("show", f"{protected['commit']}:{path}", binary=True)
            if path in paths:
                fail("duplicate migration path")
            paths.add(path)
            if len(raw) != migration["bytes"]:
                fail(f"size mismatch: {path}")
            if hashlib.sha256(raw).hexdigest() != migration["sha256"]:
                fail(f"source hash mismatch: {path}")
            if git("rev-parse", f"{protected['commit']}:{path}") != migration["gitBlob"]:
                fail(f"blob mismatch: {path}")
            match = re.fullmatch(
                r"backend/supabase/migrations/(\d{14})_([a-z0-9_]+)\.sql",
                path,
            )
            if not match or [match.group(1), match.group(2)] != [
                migration["version"],
                migration["name"],
            ]:
                fail(f"path identity mismatch: {path}")
            observed = build_carrier.source_metadata(parser, path, temp_root)
            for key in (
                "statementCount",
                "statementVectorSha256",
                "transactionControls",
            ):
                if observed[key] != migration[key]:
                    fail(f"{key} mismatch: {path}")
            versions.append(migration["version"])

    if versions != sorted(versions) or len(versions) != 11:
        fail("ordered target set mismatch")
    transition = carrier["transition"]
    if transition["targetCount"] != 11 or transition["migrationOrder"] != versions:
        fail("transition binding mismatch")
    if carrier["existingExecutorCompatibility"]["adminRecordSqlSuccessor"]["targetCoverageCount"] != 0:
        fail("successor compatibility changed")
    if carrier["existingExecutorCompatibility"]["genericReleaseManifest"]["targetCoverageCount"] != 0:
        fail("generic manifest compatibility changed")
    if carrier["mode"] != "review_only_non_executable":
        fail("carrier became executable")
    if carrier["requiredExecutionHolds"]["currentTaskAuthorizesExecution"] is not False:
        fail("authorization boundary changed")
    print(json.dumps({"status": "passed", "migrations": 11, "remoteReads": 0, "writes": 0}))


if __name__ == "__main__":
    main()
