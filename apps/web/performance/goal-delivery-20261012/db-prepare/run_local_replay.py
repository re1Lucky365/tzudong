#!/usr/bin/env python3
"""Replay the exact protected-main DB tests in a caller-isolated PG17.6 process."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence


ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
COMMIT = "056a86600f412eb42df4304e3206841679012f3e"
TREE = "4b47fe832c375a9a0f829332c354379c042ace06"
EXPECTED_PG_VERSION = "17.6"
HISTORICAL_RECEIPT = HERE / "local-replay-v1.json"
DEFAULT_OUTPUT_ROOT = HERE / "attempts"
REQUIRED_PG_BINARIES = (
    "postgres",
    "initdb",
    "pg_ctl",
    "psql",
    "createdb",
    "dropdb",
)
HELP_MARKERS = {
    "postgres": ("PostgreSQL server", "Usage:"),
    "initdb": ("PostgreSQL database cluster", "Usage:"),
    "pg_ctl": ("control a PostgreSQL server", "Usage:"),
    "psql": ("PostgreSQL interactive terminal", "Usage:"),
    "createdb": ("PostgreSQL database", "Usage:"),
    "dropdb": ("PostgreSQL database", "Usage:"),
}
SAFE_PARENT_ENV = ("TZ", "SYSTEMROOT")
ATTEMPT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MODULES = [
    "backend.supabase.tests.test_review_media_commit_cleanup",
    "backend.supabase.tests.test_review_media_catalog_integration",
    "backend.supabase.tests.test_admin_evaluation_revision_safeupdate",
    "backend.supabase.tests.test_admin_record_expired_preview_readback",
    "backend.supabase.tests.test_admin_verification_durable_staging",
    "backend.supabase.tests.test_review_storage_retirement_contract",
    "backend.supabase.tests.test_review_storage_pg15_replay",
]


class ReplayFailure(RuntimeError):
    """Fail closed with a stable code and no captured provider/database output."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def git(*args: str) -> bytes:
    try:
        return subprocess.check_output(
            ["git", *args],
            cwd=ROOT,
            env=_runtime_probe_environment(),
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        raise ReplayFailure("git_source_read_failed") from None


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _runtime_probe_environment() -> dict[str, str]:
    return {"PATH": os.defpath, "LC_ALL": "C", "LANG": "C"}


def create_owned_workspace() -> Path:
    scratch_root = Path("/tmp") if os.name != "nt" else Path(tempfile.gettempdir())
    try:
        scratch_root = scratch_root.resolve(strict=True)
        metadata = scratch_root.stat()
    except OSError:
        raise ReplayFailure("short_scratch_root_unavailable") from None
    if not stat.S_ISDIR(metadata.st_mode):
        raise ReplayFailure("short_scratch_root_unsafe")
    try:
        workspace = Path(tempfile.mkdtemp(prefix="tzr-", dir=scratch_root))
        workspace.chmod(0o700)
    except OSError:
        raise ReplayFailure("owned_workspace_create_failed") from None
    return workspace


def resolve_pg_bin(explicit: Path | None, environment: Mapping[str, str]) -> Path:
    configured = explicit
    if configured is None:
        raw = environment.get("REVIEW_REPLAY_PG_BIN") or environment.get(
            "REVIEW_TEST_PG_BIN"
        )
        configured = Path(raw) if raw else None
    if configured is None:
        raise ReplayFailure("pg_bin_required")
    try:
        resolved = configured.expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise ReplayFailure("pg_bin_unavailable") from None
    if not resolved.is_dir():
        raise ReplayFailure("pg_bin_not_directory")
    return resolved


def validate_postgres_runtime(pg_bin: Path) -> dict[str, object]:
    versions: dict[str, str] = {}
    probe_environment = _runtime_probe_environment()
    for name in REQUIRED_PG_BINARIES:
        binary = pg_bin / name
        try:
            metadata = binary.stat()
        except OSError:
            raise ReplayFailure(f"pg_binary_missing_{name}") from None
        if not stat.S_ISREG(metadata.st_mode) or not os.access(binary, os.X_OK):
            raise ReplayFailure(f"pg_binary_not_executable_{name}")
        try:
            version_result = subprocess.run(
                [str(binary), "--version"],
                env=probe_environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            help_result = subprocess.run(
                [str(binary), "--help"],
                env=probe_environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise ReplayFailure(f"pg_binary_probe_failed_{name}") from None
        version = (version_result.stdout + version_result.stderr).strip()
        help_text = help_result.stdout + help_result.stderr
        if version_result.returncode != 0 or not re.search(
            rf"\(PostgreSQL\) {re.escape(EXPECTED_PG_VERSION)}(?:\s|$)", version
        ):
            raise ReplayFailure(f"pg_binary_version_mismatch_{name}")
        if help_result.returncode != 0 or not all(
            marker in help_text for marker in HELP_MARKERS[name]
        ):
            raise ReplayFailure(f"pg_binary_help_mismatch_{name}")
        versions[name] = version
    return {
        "postgres": versions["postgres"],
        "requiredVersion": EXPECTED_PG_VERSION,
        "validatedBinaries": list(REQUIRED_PG_BINARIES),
        "versionAndHelpValidated": True,
    }


def build_child_environment(
    parent: Mapping[str, str], pg_bin: Path, runtime_root: Path
) -> dict[str, str]:
    environment = {
        name: parent[name]
        for name in SAFE_PARENT_ENV
        if parent.get(name)
    }
    environment.update(
        {
            "PATH": os.defpath,
            "LC_ALL": "C",
            "LANG": "C",
            "PYTHONHASHSEED": "0",
            "PYTHONIOENCODING": "utf-8",
            "REVIEW_TEST_PG_BIN": str(pg_bin),
            "REVIEW_TEST_PG_VERSION": EXPECTED_PG_VERSION,
            "TMPDIR": str(runtime_root),
            "TMP": str(runtime_root),
            "TEMP": str(runtime_root),
        }
    )
    return environment


def _validate_output_root(output_root: Path) -> Path:
    try:
        output_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        metadata = output_root.lstat()
        resolved = output_root.resolve(strict=True)
    except OSError:
        raise ReplayFailure("attempt_output_root_unavailable") from None
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise ReplayFailure("attempt_output_root_unsafe")
    return resolved


def reserve_attempt(output_root: Path, requested_id: str | None = None) -> tuple[str, Path]:
    root = _validate_output_root(output_root)
    attempt_id = requested_id or (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        + "-"
        + secrets.token_hex(8)
    )
    if not ATTEMPT_ID.fullmatch(attempt_id):
        raise ReplayFailure("attempt_id_invalid")
    attempt = root / f"local-replay-{attempt_id}"
    try:
        attempt.mkdir(mode=0o700)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(attempt / "reservation", flags, 0o600)
        try:
            os.write(descriptor, (attempt_id + "\n").encode("utf-8"))
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except FileExistsError:
        raise ReplayFailure("attempt_output_exists") from None
    except OSError:
        raise ReplayFailure("attempt_output_reservation_failed") from None
    return attempt_id, attempt


def write_exclusive_json(path: Path, payload: Mapping[str, object]) -> None:
    content = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode(
        "utf-8"
    )
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
        try:
            view = memoryview(content)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short write")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except FileExistsError:
        raise ReplayFailure("attempt_result_exists") from None
    except OSError:
        raise ReplayFailure("attempt_result_write_failed") from None


def _safe_archive_members(bundle: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = bundle.getmembers()
    for member in members:
        path = Path(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise ReplayFailure("unsafe_git_archive_member")
        if member.issym() or member.islnk():
            target = Path(member.linkname)
            if target.is_absolute() or ".." in target.parts:
                raise ReplayFailure("unsafe_git_archive_link")
    return members


def _terminate_test_process(process: subprocess.Popen[str]) -> tuple[str, str]:
    if process.poll() is None:
        if os.name != "nt":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
    return process.communicate()


def run_suite(
    checkout: Path, environment: Mapping[str, str], timeout_seconds: int
) -> tuple[subprocess.CompletedProcess[str], float, bool]:
    started = time.monotonic()
    process = subprocess.Popen(
        [sys.executable, "-m", "unittest", *MODULES],
        cwd=checkout,
        env=dict(environment),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=os.name != "nt",
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        stdout, stderr = _terminate_test_process(process)
    elapsed = time.monotonic() - started
    return (
        subprocess.CompletedProcess(
            process.args,
            124 if timed_out else int(process.returncode or 0),
            stdout,
            stderr,
        ),
        elapsed,
        timed_out,
    )


def cleanup_owned_clusters(runtime_root: Path, pg_bin: Path) -> dict[str, int]:
    root = runtime_root.resolve(strict=True)
    pid_files = sorted(root.rglob("postmaster.pid"))
    stopped = 0
    for pid_file in pid_files:
        if pid_file.is_symlink():
            raise ReplayFailure("owned_cluster_marker_unsafe")
        try:
            data_directory = pid_file.parent.resolve(strict=True)
            data_directory.relative_to(root)
        except (OSError, ValueError):
            raise ReplayFailure("owned_cluster_path_unsafe") from None
        try:
            result = subprocess.run(
                [
                    str(pg_bin / "pg_ctl"),
                    "-D",
                    str(data_directory),
                    "-m",
                    "immediate",
                    "-w",
                    "stop",
                ],
                env=_runtime_probe_environment(),
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise ReplayFailure("owned_cluster_cleanup_failed") from None
        if result.returncode != 0 or pid_file.exists():
            raise ReplayFailure("owned_cluster_cleanup_failed")
        stopped += 1
    if list(root.rglob("postmaster.pid")):
        raise ReplayFailure("owned_cluster_cleanup_incomplete")
    return {"clusterMarkersFound": len(pid_files), "clustersStopped": stopped}


def _parse_suite_result(
    result: subprocess.CompletedProcess[str], timed_out: bool
) -> tuple[int, float]:
    if timed_out:
        raise ReplayFailure("suite_timeout")
    combined = result.stdout + result.stderr
    match = re.search(r"Ran (\d+) tests in ([0-9.]+)s", combined)
    if result.returncode or not match or not re.search(r"(?m)^OK$", combined):
        raise ReplayFailure("suite_failed")
    return int(match.group(1)), float(match.group(2))


def replay(
    pg_bin: Path,
    output_root: Path,
    timeout_seconds: int,
    parent_environment: Mapping[str, str],
    requested_attempt_id: str | None = None,
) -> Path:
    if git("rev-parse", "origin/main").decode().strip() != COMMIT:
        raise ReplayFailure("origin_main_moved")
    if git("rev-parse", f"{COMMIT}^{{tree}}").decode().strip() != TREE:
        raise ReplayFailure("source_tree_mismatch")
    runtime = validate_postgres_runtime(pg_bin)
    historical_bytes = HISTORICAL_RECEIPT.read_bytes()
    historical_sha256 = sha256_bytes(historical_bytes)
    attempt_id, attempt = reserve_attempt(output_root, requested_attempt_id)
    result_path = attempt / "result.json"
    workspace = create_owned_workspace()
    checkout = workspace / "checkout"
    runtime_root = workspace / "runtime"
    checkout.mkdir(mode=0o700)
    runtime_root.mkdir(mode=0o700)
    cleanup = {"clusterMarkersFound": 0, "clustersStopped": 0}
    workspace_disposition = "removed"
    started_at = datetime.now(timezone.utc).isoformat()
    failure: ReplayFailure | None = None
    result: subprocess.CompletedProcess[str] | None = None
    elapsed = 0.0
    timed_out = False
    tests_run = 0
    reported_seconds = 0.0
    try:
        archive = git("archive", COMMIT)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
            bundle.extractall(checkout, members=_safe_archive_members(bundle))
        child_environment = build_child_environment(
            parent_environment, pg_bin, runtime_root
        )
        result, elapsed, timed_out = run_suite(
            checkout, child_environment, timeout_seconds
        )
        tests_run, reported_seconds = _parse_suite_result(result, timed_out)
    except ReplayFailure as exc:
        failure = exc
    except (OSError, subprocess.SubprocessError, tarfile.TarError):
        failure = ReplayFailure("replay_execution_failed")
    try:
        cleanup = cleanup_owned_clusters(runtime_root, pg_bin)
    except ReplayFailure as cleanup_failure:
        failure = cleanup_failure
        workspace_disposition = "preserved_after_cleanup_failure"
    if workspace_disposition == "removed":
        try:
            shutil.rmtree(workspace)
        except OSError:
            failure = ReplayFailure("owned_workspace_cleanup_failed")
            workspace_disposition = "preserved_after_cleanup_failure"
    try:
        historical_unchanged = HISTORICAL_RECEIPT.read_bytes() == historical_bytes
    except OSError:
        historical_unchanged = False
    if not historical_unchanged:
        failure = ReplayFailure("historical_receipt_changed")
    common: dict[str, object] = {
        "schemaVersion": 2,
        "attemptId": attempt_id,
        "startedAt": started_at,
        "source": {
            "commit": COMMIT,
            "tree": TREE,
            "archive": "git archive exact commit",
        },
        "runtime": {
            **runtime,
            "network": "none required by selected suite",
            "hostedReads": 0,
            "hostedWrites": 0,
            "storageWrites": 0,
            "providerCalls": 0,
        },
        "custody": {
            "childEnvironment": "allowlist-v1",
            "dockerRoutingInherited": False,
            "databaseRoutingInherited": False,
            "attemptOutput": "exclusive-v1",
            "historicalReceipt": "local-replay-v1.json",
            "historicalReceiptSha256": historical_sha256,
            "historicalReceiptMutated": False,
            "ownedWorkspaceDisposition": workspace_disposition,
            **cleanup,
        },
    }
    if failure is not None:
        write_exclusive_json(
            result_path,
            {
                **common,
                "status": "failed",
                "failureCode": failure.code,
                "suite": {
                    "modules": MODULES,
                    "timeoutSeconds": timeout_seconds,
                    "timedOut": timed_out,
                    "processReturnCode": None if result is None else result.returncode,
                },
            },
        )
        raise ReplayFailure(failure.code)
    receipt = {
        **common,
        "status": "passed",
        "suite": {
            "modules": MODULES,
            "testsRun": tests_run,
            "failures": 0,
            "errors": 0,
            "skips": 0,
            "reportedSeconds": reported_seconds,
            "wallSeconds": round(elapsed, 6),
            "timeoutSeconds": timeout_seconds,
        },
        "scope": {
            "proves": [
                "target source contracts",
                "review media catalog integration",
                "rollback and permission checks covered by the selected tests",
                "PG17.6 compatibility exercised by the integration fixture",
                "caller Docker and database routing variables were not inherited",
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
    write_exclusive_json(result_path, receipt)
    return result_path


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pg-bin",
        type=Path,
        help="PostgreSQL 17.6 bin directory; otherwise REVIEW_REPLAY_PG_BIN or REVIEW_TEST_PG_BIN",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="attempt root; each run reserves a new exclusive directory",
    )
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--attempt-id", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if not 1 <= args.timeout_seconds <= 900:
        parser.error("--timeout-seconds must be between 1 and 900")
    return args


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    try:
        pg_bin = resolve_pg_bin(args.pg_bin, os.environ)
        result_path = replay(
            pg_bin,
            args.output_dir,
            args.timeout_seconds,
            os.environ,
            args.attempt_id,
        )
    except ReplayFailure as exc:
        raise SystemExit(f"local replay refused: {exc.code}") from None
    print(
        json.dumps(
            {"status": "passed", "path": str(result_path)}, ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
