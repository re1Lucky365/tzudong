from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SOURCE = Path(__file__).with_name("run_local_replay.py")
SPEC = importlib.util.spec_from_file_location("goal_delivery_run_local_replay", SOURCE)
assert SPEC and SPEC.loader
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)


def fake_archive() -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as bundle:
        member = tarfile.TarInfo("backend")
        member.type = tarfile.DIRTYPE
        member.mode = 0o755
        bundle.addfile(member)
    return output.getvalue()


class RunLocalReplayTests(unittest.TestCase):
    def make_fake_pg_bin(self, root: Path, version: str = "17.6") -> Path:
        binary_root = root / "pg-bin"
        binary_root.mkdir()
        help_markers = {
            name: " ".join(markers)
            for name, markers in replay.HELP_MARKERS.items()
        }
        script = (
            f"#!{sys.executable}\n"
            "import pathlib,sys\n"
            f"version={version!r}\n"
            f"help_markers={help_markers!r}\n"
            "name=pathlib.Path(sys.argv[0]).name\n"
            "if sys.argv[1:] == ['--version']:\n"
            " print(f'{name} (PostgreSQL) {version}')\n"
            "elif sys.argv[1:] == ['--help']:\n"
            " print(help_markers[name])\n"
            "else:\n"
            " raise SystemExit(2)\n"
        )
        for name in replay.REQUIRED_PG_BINARIES:
            path = binary_root / name
            path.write_text(script, encoding="utf-8")
            path.chmod(0o700)
        return binary_root

    def test_owned_workspace_uses_a_short_private_path_for_postgres_sockets(self):
        workspace = replay.create_owned_workspace()
        try:
            self.assertLess(len(str(workspace / "runtime" / "review-media-pg-12345678")), 90)
            self.assertEqual(workspace.stat().st_mode & 0o777, 0o700)
        finally:
            shutil.rmtree(workspace)

    def test_explicit_or_configured_pg_bin_is_required_and_exactly_validated(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            valid = self.make_fake_pg_bin(root)
            self.assertEqual(replay.resolve_pg_bin(valid, {}), valid.resolve())
            self.assertEqual(
                replay.resolve_pg_bin(None, {"REVIEW_REPLAY_PG_BIN": str(valid)}),
                valid.resolve(),
            )
            runtime = replay.validate_postgres_runtime(valid)
            self.assertEqual(runtime["requiredVersion"], "17.6")
            self.assertEqual(
                runtime["validatedBinaries"], list(replay.REQUIRED_PG_BINARIES)
            )
            self.assertTrue(runtime["versionAndHelpValidated"])
        with self.assertRaisesRegex(replay.ReplayFailure, "pg_bin_required"):
            replay.resolve_pg_bin(None, {})
        with tempfile.TemporaryDirectory() as raw:
            incompatible = self.make_fake_pg_bin(Path(raw), version="17.11")
            with self.assertRaisesRegex(
                replay.ReplayFailure, "pg_binary_version_mismatch_postgres"
            ):
                replay.validate_postgres_runtime(incompatible)

    def test_child_environment_is_allowlisted_and_forces_local_pg_routing(self):
        parent = {
            "PATH": "/fixture/bin",
            "LANG": "ko_KR.UTF-8",
            "HOME": "/private/fixture-home",
            "DATABASE_URL": "postgresql://production.invalid/secret",
            "SUPABASE_DB_URL": "postgresql://production.invalid/other",
            "PGHOST": "production.invalid",
            "PGPASSWORD": "must-not-leak",
            "REVIEW_TEST_DOCKER_CONTEXT": "foreign-context",
            "REVIEW_TEST_DOCKER_CONTAINER": "foreign-container",
            "PYTHONPATH": "/foreign/source",
        }
        environment = replay.build_child_environment(
            parent, Path("/fixture/pg-bin"), Path("/fixture/runtime")
        )
        self.assertEqual(environment["PATH"], os.defpath)
        self.assertEqual(environment["REVIEW_TEST_PG_BIN"], "/fixture/pg-bin")
        self.assertEqual(environment["REVIEW_TEST_PG_VERSION"], "17.6")
        self.assertEqual(environment["TMPDIR"], "/fixture/runtime")
        for forbidden in (
            "HOME",
            "DATABASE_URL",
            "SUPABASE_DB_URL",
            "PGHOST",
            "PGPASSWORD",
            "REVIEW_TEST_DOCKER_CONTEXT",
            "REVIEW_TEST_DOCKER_CONTAINER",
            "PYTHONPATH",
        ):
            self.assertNotIn(forbidden, environment)

    def test_attempt_output_is_exclusive_and_does_not_touch_historical_receipt(self):
        historical_before = replay.HISTORICAL_RECEIPT.read_bytes()
        historical_map = replay.HERE / "artifact-map-v1.json"
        historical_sidecar = replay.HERE / "artifact-map-v1.sha256"
        map_before = historical_map.read_bytes()
        sidecar_before = historical_sidecar.read_bytes()
        with tempfile.TemporaryDirectory() as raw:
            output_root = Path(raw) / "attempts"
            attempt_id, attempt = replay.reserve_attempt(output_root, "fixed-attempt")
            self.assertEqual(attempt_id, "fixed-attempt")
            replay.write_exclusive_json(attempt / "result.json", {"status": "passed"})
            self.assertEqual(
                json.loads((attempt / "result.json").read_text(encoding="utf-8")),
                {"status": "passed"},
            )
            with self.assertRaisesRegex(
                replay.ReplayFailure, "attempt_output_exists"
            ):
                replay.reserve_attempt(output_root, "fixed-attempt")
            with self.assertRaisesRegex(
                replay.ReplayFailure, "attempt_result_exists"
            ):
                replay.write_exclusive_json(
                    attempt / "result.json", {"status": "replacement"}
                )
        self.assertEqual(replay.HISTORICAL_RECEIPT.read_bytes(), historical_before)
        self.assertEqual(historical_map.read_bytes(), map_before)
        self.assertEqual(historical_sidecar.read_bytes(), sidecar_before)

    def test_owned_cluster_cleanup_stops_only_markers_under_runtime_root(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = root / "review-media-pg-owned" / "data"
            data.mkdir(parents=True)
            marker = data / "postmaster.pid"
            marker.write_text("12345\n", encoding="utf-8")

            def successful_stop(*args, **kwargs):
                self.assertEqual(Path(args[0][2]), data.resolve())
                marker.unlink()
                return subprocess.CompletedProcess(args[0], 0, "", "")

            with mock.patch.object(
                replay.subprocess, "run", side_effect=successful_stop
            ) as run:
                result = replay.cleanup_owned_clusters(root, Path("/fixture/pg-bin"))
            self.assertEqual(result, {"clusterMarkersFound": 1, "clustersStopped": 1})
            self.assertEqual(run.call_count, 1)

    def test_owned_cluster_cleanup_failure_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = root / "review-media-pg-owned" / "data"
            data.mkdir(parents=True)
            (data / "postmaster.pid").write_text("12345\n", encoding="utf-8")
            failed = subprocess.CompletedProcess([], 1, "", "fixture failure")
            with mock.patch.object(replay.subprocess, "run", return_value=failed):
                with self.assertRaisesRegex(
                    replay.ReplayFailure, "owned_cluster_cleanup_failed"
                ):
                    replay.cleanup_owned_clusters(root, Path("/fixture/pg-bin"))

    def test_suite_failure_writes_only_a_sanitized_exclusive_attempt_result(self):
        historical_before = replay.HISTORICAL_RECEIPT.read_bytes()

        def git_fixture(*args: str) -> bytes:
            if args == ("rev-parse", "origin/main"):
                return (replay.COMMIT + "\n").encode()
            if args == ("rev-parse", f"{replay.COMMIT}^{{tree}}"):
                return (replay.TREE + "\n").encode()
            if args == ("archive", replay.COMMIT):
                return fake_archive()
            raise AssertionError(args)

        failed_process = subprocess.CompletedProcess(
            [sys.executable], 1, "captured-public-output", "captured-private-output"
        )
        with tempfile.TemporaryDirectory() as raw, mock.patch.object(
            replay, "git", side_effect=git_fixture
        ), mock.patch.object(
            replay,
            "validate_postgres_runtime",
            return_value={
                "postgres": "postgres (PostgreSQL) 17.6",
                "requiredVersion": "17.6",
                "validatedBinaries": list(replay.REQUIRED_PG_BINARIES),
                "versionAndHelpValidated": True,
            },
        ), mock.patch.object(
            replay, "run_suite", return_value=(failed_process, 0.25, False)
        ):
            output_root = Path(raw) / "attempts"
            with self.assertRaisesRegex(replay.ReplayFailure, "suite_failed"):
                replay.replay(
                    Path("/fixture/pg-bin"),
                    output_root,
                    30,
                    {
                        "DATABASE_URL": "postgresql://production.invalid/secret",
                        "PGPASSWORD": "must-not-leak",
                    },
                    "failed-attempt",
                )
            result_path = (
                output_root / "local-replay-failed-attempt" / "result.json"
            )
            raw_result = result_path.read_text(encoding="utf-8")
            payload = json.loads(raw_result)
            self.assertEqual(payload["status"], "failed")
            self.assertEqual(payload["failureCode"], "suite_failed")
            self.assertNotIn("captured-public-output", raw_result)
            self.assertNotIn("captured-private-output", raw_result)
            self.assertNotIn("production.invalid", raw_result)
            self.assertNotIn("must-not-leak", raw_result)
        self.assertEqual(replay.HISTORICAL_RECEIPT.read_bytes(), historical_before)


if __name__ == "__main__":
    unittest.main()
