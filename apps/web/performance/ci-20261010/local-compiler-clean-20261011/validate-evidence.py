#!/usr/bin/env python3
"""Validate public clean-compiler evidence without private filesystem paths."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_benchmark(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("frozen_compiler_benchmark", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot import benchmark scorer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--public-dir", type=Path, required=True)
    parser.add_argument("--benchmark", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replace-generated", action="store_true")
    args = parser.parse_args()
    public_dir = args.public_dir.resolve(strict=True)
    benchmark_path = args.benchmark.resolve(strict=True)
    output = args.output.resolve()
    if output.exists() and not args.replace_generated:
        raise RuntimeError("validation output already exists")
    paths = {
        name: public_dir / name
        for name in (
            "configuration.json",
            "raw.json",
            "summary.json",
            "report.md",
            "input-manifest.json",
            "sanitization-receipt.json",
            "failed-v1-receipt.json",
        )
    }
    for name, path in paths.items():
        require(path.is_file(), f"missing public evidence: {name}")
        require(b"/Users/" not in path.read_bytes(), f"private path in public evidence: {name}")
    config = json.loads(paths["configuration.json"].read_text(encoding="utf-8"))
    raw = json.loads(paths["raw.json"].read_text(encoding="utf-8"))
    summary = json.loads(paths["summary.json"].read_text(encoding="utf-8"))
    manifest = json.loads(paths["input-manifest.json"].read_text(encoding="utf-8"))
    receipt = json.loads(paths["sanitization-receipt.json"].read_text(encoding="utf-8"))
    failed = json.loads(paths["failed-v1-receipt.json"].read_text(encoding="utf-8"))
    report = paths["report.md"].read_text(encoding="utf-8")
    checks: dict[str, bool] = {}
    checks["embeddedConfigEqualsPublicConfig"] = raw["metadata"]["experimentConfig"] == config
    checks["benchmarkScriptHashMatches"] = (
        sha256_file(benchmark_path)
        == config["expectedBenchmarkScriptSha256"]
        == raw["metadata"]["benchmarkScriptSha256"]
    )
    benchmark = load_benchmark(benchmark_path)
    checks["scorerRegenerationEqualsSummary"] = benchmark.analyze(raw) == summary
    checks["sampleCountsPreserved"] = (
        len(raw["measuredPairs"]) == config["pairs"] == 7
        and len(raw["aaPairs"]) == config["aaPairs"] == 7
        and summary["sampleCountPaired"] == 7
        and summary["sampleCountAaPaired"] == 7
    )
    checks["expectedNonAdmission"] = (
        summary["evidenceAdmission"]["admitted"] is False
        and summary["evidenceAdmission"]["officialApproval"] is False
        and summary["evidenceAdmission"]["budgetChecks"]["noiseP95"] is False
        and summary["aaNoise"]["absoluteRelativeDifferencePercent"]["p95"]
        > config["acceptanceBudgets"][
            "noiseAaP95AbsoluteRelativeDifferencePercentMaximum"
        ]
    )
    parity_commands = [
        command
        for group in ("measuredPairs", "aaPairs")
        for pair in raw[group]
        for sequence in pair["runs"]
        for command in sequence["commands"]
        if command["command"] == "parity"
    ]
    measured_parity = manifest["measuredParityOutput"]
    checks["allMeasuredParityOutputsIdentical"] = (
        len(parity_commands) == measured_parity["commands"] == 28
        and len(
            {
                (command["stdoutSha256"], command["stdoutBytes"])
                for command in parity_commands
            }
        )
        == measured_parity["uniqueOutputs"]
        == 1
        and all(
            command["success"] is True
            and command["stdoutSha256"] == measured_parity["stdoutSha256"]
            and command["stdoutBytes"] == measured_parity["stdoutBytes"]
            for command in parity_commands
        )
    )
    payload = manifest["postMeasurementParityPayload"]
    native_digest = manifest["logicalInputDigests"]["native"]
    compat_digest = manifest["logicalInputDigests"]["compat"]
    checks["listFilesManifestBindsParityPayload"] = payload == {
        "status": "passed",
        "diagnostics": 0,
        "logicalInputs": native_digest["logicalInputs"],
        "logicalInputNamesSha256": native_digest["logicalInputNamesSha256"],
        "nonLibraryContentSha256": native_digest["nonLibraryContentSha256"],
        "standardLibraryContentSha256": {
            "native": native_digest["standardLibraryContentSha256"],
            "compat": compat_digest["standardLibraryContentSha256"],
        },
    }
    coverage = manifest["sourceCoverage"]
    checks["allAppInputsInFrozenGitTree"] = (
        coverage["allAppInputsTracked"] is True
        and coverage["untrackedOrIgnoredAppInputs"] == []
        and coverage["appInputs"] == coverage["trackedAppInputs"] == 813
    )
    checks["privateRawBoundByReceipt"] = (
        manifest["benchmarkRawSha256"]
        == receipt["hashes"]["privateRawSha256"]
        == "d01bc29fbb97859dd5961c1d5d44369d4c79a2c4a08cbd162750869c8e45fe20"
    )
    checks["publicHashesMatchReceipt"] = all(
        receipt["hashes"][key] == sha256_file(paths[name])
        for key, name in (
            ("publicConfigurationSha256", "configuration.json"),
            ("publicRawSha256", "raw.json"),
            ("publicSummarySha256", "summary.json"),
            ("publicReportSha256", "report.md"),
        )
    )
    checks["declaredPathRedactionsExact"] = receipt["redactedJsonPointers"] == {
        "configuration.json": ["/expectedNodeModulesTarget"],
        "raw.json": [
            "/metadata/experimentConfig/expectedNodeModulesTarget",
            "/metadata/nodeModulesTarget",
        ],
    }
    checks["reportDistinguishesEstimatorsAndAdmission"] = all(
        phrase in report
        for phrase in (
            "is 46.72%",
            "46.61% value above is the mean",
            "neither is admitted",
        )
    )
    checks["failedAttemptExcluded"] = (
        failed["admitted"] is False
        and failed["successfulSequences"] == 0
        and failed["aaPairsRecorded"] == 0
    )
    require(all(checks.values()), f"public evidence validation failed: {checks}")
    validation = {
        "schema": "tzudong-ci-performance/v1/local-compiler-validation",
        "valid": True,
        "checks": checks,
        "scorer": {
            "regeneratedSummarySha256": hashlib.sha256(
                canonical_json(benchmark.analyze(raw)).encode("utf-8")
            ).hexdigest(),
            "retainedSummarySha256": sha256_file(paths["summary.json"]),
        },
        "decision": {
            "admitted": False,
            "officialApproval": False,
            "failedBudget": "noiseAaP95AbsoluteRelativeDifferencePercentMaximum",
            "observedPercent": summary["aaNoise"]["absoluteRelativeDifferencePercent"][
                "p95"
            ],
            "maximumPercent": config["acceptanceBudgets"][
                "noiseAaP95AbsoluteRelativeDifferencePercentMaximum"
            ],
        },
        "validatorScriptSha256": sha256_file(Path(__file__).resolve()),
    }
    if output.exists():
        existing = json.loads(output.read_text(encoding="utf-8"))
        existing.pop("validatorScriptSha256", None)
        comparable = dict(validation)
        comparable.pop("validatorScriptSha256", None)
        require(existing == comparable, "existing validation result differs")
    output.write_text(canonical_json(validation), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
