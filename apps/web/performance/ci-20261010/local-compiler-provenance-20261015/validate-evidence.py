#!/usr/bin/env python3
"""Validate and inventory the compiler provenance rerun."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
BENCHMARK_PATH = ROOT.parent / "local-compiler" / "benchmark.py"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_benchmark():
    spec = importlib.util.spec_from_file_location(
        "compiler_provenance_benchmark", BENCHMARK_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load retained benchmark scorer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> int:
    names = (
        "configuration.json",
        "raw.json",
        "summary.json",
        "report.md",
        "input-manifest.json",
        "compiler-provenance-inventory.json",
        "sanitization-receipt.json",
    )
    paths = {name: ROOT / name for name in names}
    for name, path in paths.items():
        require(path.is_file(), f"missing evidence: {name}")
        require(b"/Users/" not in path.read_bytes(), f"private path remains: {name}")
    config = json.loads(paths["configuration.json"].read_text(encoding="utf-8"))
    raw = json.loads(paths["raw.json"].read_text(encoding="utf-8"))
    summary = json.loads(paths["summary.json"].read_text(encoding="utf-8"))
    manifest = json.loads(paths["input-manifest.json"].read_text(encoding="utf-8"))
    inventory = json.loads(
        paths["compiler-provenance-inventory.json"].read_text(encoding="utf-8")
    )
    receipt = json.loads(
        paths["sanitization-receipt.json"].read_text(encoding="utf-8")
    )
    benchmark = load_benchmark()
    checks = {
        "embeddedConfigMatches": raw["metadata"]["experimentConfig"] == config,
        "benchmarkScriptHashMatches": (
            sha256_file(BENCHMARK_PATH)
            == config["expectedBenchmarkScriptSha256"]
            == raw["metadata"]["benchmarkScriptSha256"]
        ),
        "scorerRegenerationMatches": benchmark.analyze(raw) == summary,
        "sampleCountsPreserved": (
            len(raw["measuredPairs"])
            == summary["sampleCountPaired"]
            == config["pairs"]
            == 7
            and len(raw["aaPairs"])
            == summary["sampleCountAaPaired"]
            == config["aaPairs"]
            == 7
        ),
        "sourceContractUnchanged": raw["metadata"]["sourceContractUnchanged"] is True,
        "expectedNonAdmissionPreserved": (
            summary["evidenceAdmission"]["admitted"] is False
            and summary["evidenceAdmission"]["officialApproval"] is False
            and summary["evidenceAdmission"]["budgetChecks"]["noiseP95"] is False
        ),
        "inputManifestBoundToRaw": (
            manifest["benchmarkRawSha256"]
            == receipt["privateHashes"]["raw.json"]
            and manifest["gitHead"] == raw["metadata"]["gitHead"]
            and manifest["sourceTreeSha"] == raw["metadata"]["sourceTreeSha"]
            and manifest["measuredParityOutput"]["commands"] == 28
        ),
    }
    expected_hashes = config["expectedDependencyHashes"]
    checks["dependencyHashesStable"] = (
        len(expected_hashes) == 12
        and expected_hashes
        == raw["metadata"]["dependencyHashes"]
        == raw["metadata"]["snapshotDependencyHashes"]
    )
    role_paths = config["compilerProvenance"]
    roles = raw["metadata"]["compilerProvenance"]
    checks["executedCompilerRolesBound"] = (
        set(role_paths) == benchmark.COMPILER_PROVENANCE_ROLES
        and len(roles) == 8
        and all(
            roles[role]
            == {"path": relative, "sha256": expected_hashes[relative]}
            for role, relative in role_paths.items()
        )
    )
    inventory_body = {
        key: value
        for key, value in inventory.items()
        if key not in {
            "dependencyFileCount",
            "executedCompilerRoleCount",
            "inventorySha256",
        }
    }
    checks["provenanceInventorySelfHashes"] = (
        inventory["dependencyFileCount"] == 12
        and inventory["executedCompilerRoleCount"] == 8
        and inventory["inventorySha256"]
        == sha256_bytes(canonical_json(inventory_body).encode("utf-8"))
    )
    public_hashes = receipt["publicHashes"]
    checks["sanitizedPublicHashesMatch"] = all(
        public_hashes[name] == sha256_file(path)
        for name, path in paths.items()
        if name != "sanitization-receipt.json"
    )
    require(all(checks.values()), f"evidence validation failed: {checks}")
    validation = {
        "schema": "tzudong-ci-performance/v1/compiler-provenance-validation",
        "checks": checks,
        "dependencyFileCount": inventory["dependencyFileCount"],
        "executedCompilerRoleCount": inventory["executedCompilerRoleCount"],
        "provenanceInventorySha256": inventory["inventorySha256"],
        "sampleCountPaired": summary["sampleCountPaired"],
        "sampleCountAaPaired": summary["sampleCountAaPaired"],
        "admitted": summary["evidenceAdmission"]["admitted"],
        "failedBudgetChecks": sorted(
            key
            for key, passed in summary["evidenceAdmission"]["budgetChecks"].items()
            if not passed
        ),
    }
    validation_path = ROOT / "validation.json"
    validation_path.write_text(canonical_json(validation), encoding="utf-8")
    roles_by_name = {
        "build-evidence.py": "path sanitizer and provenance inventory builder",
        "validate-evidence.py": "deterministic evidence validator",
        "configuration.json": "pre-measurement frozen contract",
        "raw.json": "path-sanitized raw measurement",
        "summary.json": "unchanged scorer output",
        "report.md": "unchanged measurement report",
        "input-manifest.json": "logical compiler input names and content hashes",
        "compiler-provenance-inventory.json": "executed compiler byte inventory",
        "sanitization-receipt.json": "private-to-public hash and redaction receipt",
        "validation.json": "deterministic validation result",
    }
    artifacts = []
    for name, role in roles_by_name.items():
        path = ROOT / name
        require(path.is_file(), f"missing artifact-map input: {name}")
        artifacts.append(
            {
                "path": name,
                "role": role,
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    artifact_map = {
        "schema": "tzudong-ci-performance/v1/artifact-map",
        "artifacts": artifacts,
    }
    artifact_map_path = ROOT / "artifact-map.json"
    artifact_map_path.write_text(canonical_json(artifact_map), encoding="utf-8")
    (ROOT / "artifact-map.json.sha256").write_text(
        f"{sha256_file(artifact_map_path)}  artifact-map.json\n", encoding="utf-8"
    )
    print(canonical_json(validation), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
