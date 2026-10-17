#!/usr/bin/env python3
"""Regression coverage for the frozen-source review carrier verifier."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import verify_carrier  # noqa: E402


EXPECTED_SCALAR_LEAF_COUNT = 266
EXPECTED_PATH_VECTOR_SHA256 = "fdc0dffc7231cfca4274462776f92b02b262be3bf722406b7655803768b288a9"
EXPECTED_TOP_LEVEL_KEYS = {
    "schemaVersion",
    "id",
    "mode",
    "projectRef",
    "protectedSource",
    "priorHostedObservation",
    "transition",
    "criticalPreconditions",
    "migrations",
    "expectedTerminalContracts",
    "applicationDependency",
    "existingExecutorCompatibility",
    "executorSources",
    "requiredExecutionHolds",
    "exclusions",
}


def scalar_paths(value: Any, path: tuple[str | int, ...] = ()) -> list[tuple[str | int, ...]]:
    if isinstance(value, dict):
        paths: list[tuple[str | int, ...]] = []
        for key, child in value.items():
            paths.extend(scalar_paths(child, path + (key,)))
        return paths
    if isinstance(value, list):
        paths = []
        for index, child in enumerate(value):
            paths.extend(scalar_paths(child, path + (index,)))
        return paths
    return [path]


def at_path(value: Any, path: tuple[str | int, ...]) -> Any:
    current = value
    for part in path:
        current = current[part]
    return current


def replace_at_path(value: Any, path: tuple[str | int, ...], replacement: Any) -> None:
    current = value
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = replacement


def mutated_scalar(value: Any) -> Any:
    if isinstance(value, bool):
        return not value
    if isinstance(value, int):
        return value + 1
    if isinstance(value, float):
        return value + 0.5
    if isinstance(value, str):
        return value + "#mutated"
    if value is None:
        return "mutated"
    raise AssertionError(f"unsupported scalar type: {type(value).__name__}")


def encoded(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode()


class CarrierVerifierRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.checked = verify_carrier.read_regular_bytes(verify_carrier.CARRIER)
        cls.canonical = verify_carrier.canonical_carrier_bytes()
        cls.document = json.loads(cls.canonical)

    def test_checked_carrier_is_the_complete_canonical_build(self) -> None:
        before = hashlib.sha256(self.checked).hexdigest()
        self.assertEqual(self.checked, self.canonical)
        self.assertEqual(verify_carrier.verify_carrier()["status"], "passed")
        after = hashlib.sha256(
            verify_carrier.read_regular_bytes(verify_carrier.CARRIER)
        ).hexdigest()
        self.assertEqual(after, before)

    def test_legacy_security_contract_reproduction_is_rejected_now(self) -> None:
        mutated = copy.deepcopy(self.document)
        mutated["criticalPreconditions"]["ownerCleanup"][
            "requiredPostimageSha256"
        ] = "0" * 64
        with tempfile.TemporaryDirectory(prefix="tzudong-carrier-legacy-test-") as temporary:
            candidate = Path(temporary) / "carrier.json"
            candidate.write_bytes(encoded(mutated))
            with mock.patch.object(
                verify_carrier,
                "canonical_carrier_bytes",
                return_value=self.canonical,
            ):
                with self.assertRaises(SystemExit) as rejected:
                    verify_carrier.verify_carrier(candidate)
        self.assertEqual(str(rejected.exception), verify_carrier.FIXED_MISMATCH_ERROR)

    def test_every_scalar_field_mutation_fails_with_one_fixed_error(self) -> None:
        paths = scalar_paths(self.document)
        path_vector = json.dumps(
            ["/" + "/".join(map(str, path)) for path in paths],
            separators=(",", ":"),
        ).encode()
        self.assertEqual(len(paths), EXPECTED_SCALAR_LEAF_COUNT)
        self.assertEqual(hashlib.sha256(path_vector).hexdigest(), EXPECTED_PATH_VECTOR_SHA256)
        self.assertEqual(set(self.document), EXPECTED_TOP_LEVEL_KEYS)

        covered_top_level: set[str] = set()
        with tempfile.TemporaryDirectory(prefix="tzudong-carrier-matrix-test-") as temporary:
            candidate = Path(temporary) / "carrier.json"
            with mock.patch.object(
                verify_carrier,
                "canonical_carrier_bytes",
                return_value=self.canonical,
            ):
                for path in paths:
                    with self.subTest(path="/".join(map(str, path))):
                        mutated = copy.deepcopy(self.document)
                        replace_at_path(mutated, path, mutated_scalar(at_path(mutated, path)))
                        candidate.write_bytes(encoded(mutated))
                        with self.assertRaises(SystemExit) as rejected:
                            verify_carrier.verify_carrier(candidate)
                        self.assertEqual(
                            str(rejected.exception),
                            verify_carrier.FIXED_MISMATCH_ERROR,
                        )
                        covered_top_level.add(str(path[0]))
        self.assertEqual(covered_top_level, EXPECTED_TOP_LEVEL_KEYS)

    def test_structural_or_serialization_drift_is_rejected(self) -> None:
        candidates = []

        added = copy.deepcopy(self.document)
        added["unexpected"] = True
        candidates.append(encoded(added))

        removed = copy.deepcopy(self.document)
        del removed["criticalPreconditions"]
        candidates.append(encoded(removed))

        candidates.append(json.dumps(self.document, ensure_ascii=False).encode())

        with tempfile.TemporaryDirectory(prefix="tzudong-carrier-structure-test-") as temporary:
            candidate_path = Path(temporary) / "carrier.json"
            with mock.patch.object(
                verify_carrier,
                "canonical_carrier_bytes",
                return_value=self.canonical,
            ):
                for candidate in candidates:
                    candidate_path.write_bytes(candidate)
                    with self.assertRaises(SystemExit) as rejected:
                        verify_carrier.verify_carrier(candidate_path)
                    self.assertEqual(
                        str(rejected.exception),
                        verify_carrier.FIXED_MISMATCH_ERROR,
                    )

    def test_symlink_carrier_is_rejected_without_exposing_the_path(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-carrier-symlink-test-") as temporary:
            symlink = Path(temporary) / "carrier.json"
            symlink.symlink_to(verify_carrier.CARRIER)
            with self.assertRaises(SystemExit) as rejected:
                verify_carrier.read_regular_bytes(symlink)
        self.assertEqual(
            str(rejected.exception),
            "carrier verification failed: carrier unavailable",
        )

    def test_regeneration_failure_uses_one_fixed_error(self) -> None:
        with mock.patch.object(
            verify_carrier.build_carrier,
            "main",
            side_effect=RuntimeError("sensitive internal detail"),
        ):
            with self.assertRaises(SystemExit) as rejected:
                verify_carrier.canonical_carrier_bytes()
        self.assertEqual(
            str(rejected.exception),
            "carrier verification failed: canonical regeneration failed",
        )

    def test_invalid_canonical_json_uses_one_fixed_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-carrier-json-test-") as temporary:
            candidate = Path(temporary) / "carrier.json"
            candidate.write_bytes(b"{")
            with mock.patch.object(
                verify_carrier,
                "canonical_carrier_bytes",
                return_value=b"{",
            ):
                with self.assertRaises(SystemExit) as rejected:
                    verify_carrier.verify_carrier(candidate)
        self.assertEqual(
            str(rejected.exception),
            "carrier verification failed: canonical regeneration failed",
        )


if __name__ == "__main__":
    unittest.main()
