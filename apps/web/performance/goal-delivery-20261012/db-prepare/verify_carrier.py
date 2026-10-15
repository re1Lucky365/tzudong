#!/usr/bin/env python3
"""Fail closed unless the checked carrier is the canonical frozen-source build."""

from __future__ import annotations

import contextlib
import io
import json
import os
import stat
import subprocess
import tempfile
from pathlib import Path

import build_carrier


HERE = Path(__file__).resolve().parent
CARRIER = HERE / "review-carrier-v1.json"
FIXED_MISMATCH_ERROR = "carrier verification failed: canonical carrier mismatch"


class _PrivateSubprocess:
    @staticmethod
    def check_output(*args: object, **kwargs: object) -> str | bytes:
        kwargs.setdefault("stderr", subprocess.DEVNULL)
        return subprocess.check_output(*args, **kwargs)


def fail(message: str) -> None:
    raise SystemExit(f"carrier verification failed: {message}")


def read_regular_bytes(path: Path) -> bytes:
    """Read one stable regular file without following a replacement symlink."""

    try:
        before = path.lstat()
    except OSError:
        fail("carrier unavailable")
    if not stat.S_ISREG(before.st_mode):
        fail("carrier unavailable")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        fail("carrier unavailable")
    try:
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(after.st_mode)
            or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
        ):
            fail("carrier unavailable")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        value = b"".join(chunks)
        finished = os.fstat(descriptor)
        if (
            (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            )
            != (
                finished.st_dev,
                finished.st_ino,
                finished.st_size,
                finished.st_mtime_ns,
                finished.st_ctime_ns,
            )
            or len(value) != finished.st_size
        ):
            fail("carrier unavailable")
        return value
    finally:
        os.close(descriptor)


def canonical_carrier_bytes() -> bytes:
    """Regenerate the complete carrier from the builder's frozen Git inputs."""

    try:
        with tempfile.TemporaryDirectory(prefix="tzudong-db-carrier-verify-") as temporary:
            temporary_root = Path(temporary)
            previous_output = build_carrier.OUT
            previous_subprocess = build_carrier.subprocess
            try:
                build_carrier.OUT = temporary_root
                build_carrier.subprocess = _PrivateSubprocess
                with contextlib.redirect_stdout(io.StringIO()):
                    build_carrier.main()
                return read_regular_bytes(temporary_root / CARRIER.name)
            finally:
                build_carrier.OUT = previous_output
                build_carrier.subprocess = previous_subprocess
    except SystemExit:
        raise
    except Exception:
        fail("canonical regeneration failed")


def assert_canonical_carrier_bytes(candidate: bytes, canonical: bytes) -> None:
    """Bind every key, value, list order, and serialized byte to the canonical build."""

    if candidate != canonical:
        raise SystemExit(FIXED_MISMATCH_ERROR)


def verify_carrier(path: Path = CARRIER) -> dict[str, int | str]:
    canonical = canonical_carrier_bytes()
    candidate = read_regular_bytes(path)
    assert_canonical_carrier_bytes(candidate, canonical)
    try:
        document = json.loads(canonical)
        migration_count = len(document["migrations"])
    except (json.JSONDecodeError, KeyError, TypeError):
        fail("canonical regeneration failed")
    return {
        "status": "passed",
        "migrations": migration_count,
        "remoteReads": 0,
        "writes": 0,
    }


def main() -> None:
    print(json.dumps(verify_carrier(), separators=(",", ":")))


if __name__ == "__main__":
    main()
