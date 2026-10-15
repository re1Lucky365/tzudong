#!/usr/bin/env python3
"""Focused regression tests for monitor-ci-performance.py."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("monitor-ci-performance.py")
SPEC = importlib.util.spec_from_file_location("monitor_ci_performance", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)


def timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_run(
    run_id: int,
    duration: int,
    *,
    event: str = "pull_request",
    conclusion: str = "success",
    status: str = "completed",
    attempt: int = 1,
    malformed: bool = False,
    incomplete_step: bool = False,
    unsafe_step_name: str | None = None,
) -> dict:
    base = datetime(2026, 10, 10, 10, 0, tzinfo=timezone.utc) + timedelta(
        minutes=run_id % 1_000
    )
    started = base + timedelta(seconds=2)
    completed = started + timedelta(seconds=duration)
    step_completed = None if incomplete_step else timestamp(completed)
    return {
        "id": run_id,
        "attempt": attempt,
        "event": event,
        "status": status,
        "conclusion": conclusion,
        "jobsTotalCount": 1,
        "jobsAttempt": attempt,
        "headSha": f"{run_id:040x}"[-40:],
        "sourceTree": f"{run_id + 10_000:040x}"[-40:],
        "workflowRevision": "a" * 64,
        "executionMode": "full_benchmark",
        "jobTopology": "b" * 64,
        "createdAt": "not-a-time" if malformed else timestamp(base),
        "updatedAt": timestamp(completed),
        "jobs": [
            {
                "status": status,
                "conclusion": conclusion,
                "createdAt": timestamp(base),
                "startedAt": timestamp(started),
                "completedAt": timestamp(completed),
                "runnerLabels": ["ubuntu-latest"],
                "steps": [
                    {
                        "number": 1,
                        "name": unsafe_step_name or "Run npm ci",
                        "status": "completed" if not incomplete_step else "in_progress",
                        "conclusion": conclusion if not incomplete_step else None,
                        "startedAt": timestamp(started),
                        "completedAt": step_completed,
                    }
                ],
            }
        ],
    }


def payload(runs: list[dict], workflow: str | None = ".github/workflows/web-admin-ci.yml") -> dict:
    result = {"runs": runs}
    if workflow is not None:
        result["workflow"] = {"path": workflow}
    return result


class MonitorCiPerformanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.checkpoint = self.root / "checkpoint.json"
        self.receipt = self.root / "receipt.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, name: str, value: object) -> Path:
        path = self.root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def invoke(self, before: Path | None = None, after: Path | None = None) -> dict:
        arguments = [
            "--checkpoint",
            str(self.checkpoint),
            "--receipt",
            str(self.receipt),
            "--bootstrap-resamples",
            "1000",
        ]
        if before is not None:
            arguments += ["--before-input", str(before)]
        if after is not None:
            arguments += ["--after-input", str(after)]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(MONITOR.main(arguments), 0)
        return json.loads(self.receipt.read_text(encoding="utf-8"))

    def assert_input_rejected(
        self, value: object, *, before: bool = False, name: str = "rejected.json"
    ) -> None:
        source = self.write(name, value)
        self.receipt.write_text("unchanged", encoding="utf-8")
        arguments = [
            "--before-input" if before else "--after-input",
            str(source),
            "--checkpoint",
            str(self.checkpoint),
            "--receipt",
            str(self.receipt),
            "--bootstrap-resamples",
            "1000",
        ]
        with self.assertRaises(MONITOR.MonitorError):
            with redirect_stdout(io.StringIO()):
                MONITOR.main(arguments)
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_improvement_signal_requires_seven_per_phase(self) -> None:
        before = self.write(
            "before.json", payload([make_run(100 + index, 100) for index in range(7)])
        )
        after = self.write(
            "after.json", payload([make_run(200 + index, 60) for index in range(7)])
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(
            cohort["metrics"]["criticalPathSeconds"]["signal"],
            "exploratory_improvement_signal",
        )
        self.assertEqual(cohort["beforeTimingSuccessCount"], 7)
        self.assertEqual(cohort["afterTimingSuccessCount"], 7)
        self.assertFalse(cohort["causalClaimAllowed"])
        self.assertIsNone(cohort["metrics"]["criticalPathSeconds"]["before"]["p95"])

    def test_regression_signal_is_distinct(self) -> None:
        before = self.write(
            "before.json", payload([make_run(300 + index, 60) for index in range(7)])
        )
        after = self.write(
            "after.json", payload([make_run(400 + index, 110) for index in range(7)])
        )
        receipt = self.invoke(before, after)
        signal = receipt["analysis"]["cohorts"][0]["metrics"][
            "criticalPathSeconds"
        ]["signal"]
        self.assertEqual(signal, "exploratory_regression_signal")

    def test_single_after_run_never_confirms_improvement(self) -> None:
        before = self.write(
            "before.json", payload([make_run(500 + index, 100) for index in range(7)])
        )
        after = self.write("after.json", payload([make_run(600, 10)]))
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertIn("minimum_7_before_and_7_after_successes_not_met", cohort["warnings"])

    def test_failure_and_cancelled_runs_are_preserved(self) -> None:
        before = self.write(
            "before.json",
            payload(
                [make_run(700 + index, 80) for index in range(7)]
                + [make_run(710, 20, conclusion="failure")]
            ),
        )
        after = self.write(
            "after.json",
            payload(
                [make_run(800 + index, 80) for index in range(7)]
                + [make_run(810, 20, conclusion="failure")]
                + [make_run(811, 20, conclusion="cancelled")]
            ),
        )
        receipt = self.invoke(before, after)
        counts = receipt["analysis"]["runConclusionCounts"]
        self.assertEqual(counts["failure"], 2)
        self.assertEqual(counts["cancelled"], 1)
        self.assertEqual(
            receipt["analysis"]["cohorts"][0]["failureSignal"],
            "failure_rate_increased",
        )

    def test_failure_rate_excludes_unfinished_attempts(self) -> None:
        rate = MONITOR.failure_rate(
            [
                {
                    "status": "completed",
                    "conclusion": "failure",
                    "timingUsable": False,
                },
                {
                    "status": "completed",
                    "conclusion": "cancelled",
                    "timingUsable": False,
                },
                {"status": "in_progress", "conclusion": "missing"},
                {"status": "completed", "conclusion": "missing"},
            ]
        )
        self.assertEqual(rate["n"], 2)
        self.assertEqual(rate["totalAttempts"], 4)
        self.assertEqual(rate["unfinishedAttempts"], 1)
        self.assertEqual(rate["incompleteTerminalAttempts"], 1)
        self.assertEqual(rate["failures"], 2)
        self.assertEqual(rate["percent"], 100.0)

    def test_duplicate_run_id_and_attempt_are_checkpointed(self) -> None:
        repeated = make_run(900, 80)
        first = self.write("first.json", payload([repeated, repeated]))
        receipt = self.invoke(after=first)
        self.assertEqual(receipt["admittedRunCount"], 1)
        self.assertEqual(receipt["duplicateRunIdCount"], 1)

        rerun = self.write("rerun.json", payload([make_run(900, 75, attempt=2)]))
        receipt = self.invoke(after=rerun)
        self.assertEqual(receipt["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertEqual(set(checkpoint["runs"]), {"900:1", "900:2"})

    def test_in_progress_run_can_be_replaced_by_completed_state(self) -> None:
        initial_run = make_run(950, 80, status="in_progress", conclusion="missing")
        initial = self.write("initial.json", payload([initial_run]))
        self.invoke(after=initial)
        completed = self.write("completed.json", payload([make_run(950, 80)]))
        receipt = self.invoke(after=completed)
        self.assertEqual(receipt["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["runs"]["950:1"]["conclusion"], "success")

    def test_malformed_timestamp_and_incomplete_step_do_not_crash(self) -> None:
        source = self.write(
            "observations.json",
            payload(
                [
                    make_run(1_000, 80, malformed=True),
                    make_run(1_001, 80, incomplete_step=True),
                ]
            ),
        )
        receipt = self.invoke(after=source)
        analysis = receipt["analysis"]
        self.assertEqual(analysis["malformedTimestampRunCount"], 1)
        self.assertEqual(analysis["incompleteStepCount"], 1)
        self.assertEqual(analysis["timingUsableRunCount"], 0)

    def test_non_object_run_and_job_entries_fail_closed(self) -> None:
        self.assert_input_rejected(
            payload([make_run(1_010, 80), None]),  # type: ignore[list-item]
            name="null-run.json",
        )
        malformed_job = make_run(1_011, 80)
        malformed_job["jobs"].append(None)
        self.assert_input_rejected(payload([malformed_job]), name="null-job.json")

    def test_job_timestamps_before_run_creation_are_rejected_from_baseline(self) -> None:
        base = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
        cases = {
            "created": {
                "createdAt": timestamp(base - timedelta(seconds=1)),
                "startedAt": timestamp(base + timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=2)),
            },
            "started": {
                "createdAt": timestamp(base - timedelta(seconds=2)),
                "startedAt": timestamp(base - timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=1)),
            },
            "completed": {
                "createdAt": timestamp(base - timedelta(seconds=3)),
                "startedAt": timestamp(base - timedelta(seconds=2)),
                "completedAt": timestamp(base - timedelta(seconds=1)),
            },
        }
        for index, (field, job_times) in enumerate(cases.items()):
            with self.subTest(field=field):
                run = make_run(1_020 + index, 80)
                run["createdAt"] = timestamp(base)
                run["jobs"][0].update(job_times)
                with self.assertRaises(MONITOR.MonitorError):
                    MONITOR.analyze_record(
                        run,
                        "before",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "c" * 64,
                    )

    def test_identical_attempt_cannot_appear_in_both_phases(self) -> None:
        repeated = make_run(1_024, 80)
        before = self.write("phase-before.json", payload([repeated]))
        after = self.write("phase-after.json", payload([repeated]))
        self.receipt.write_text("unchanged", encoding="utf-8")
        with self.assertRaises(MONITOR.MonitorError):
            with redirect_stdout(io.StringIO()):
                MONITOR.main(
                    [
                        "--before-input",
                        str(before),
                        "--after-input",
                        str(after),
                        "--checkpoint",
                        str(self.checkpoint),
                        "--receipt",
                        str(self.receipt),
                        "--bootstrap-resamples",
                        "1000",
                    ]
                )
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_zero_baseline_relative_change_is_undefined_and_absolute_regression_applies(
        self,
    ) -> None:
        interval = MONITOR.bootstrap_mean_change(
            [0.0] * 7, [200.0] * 7, 1000, 20_261_011
        )
        self.assertIsNone(interval["relativeReductionPercent95Ci"])
        self.assertEqual(
            interval["relativeReductionStatus"], "undefined_zero_baseline"
        )
        mixed_zero_interval = MONITOR.bootstrap_mean_change(
            [0.0, 100.0] * 4, [200.0] * 8, 1000, 20_261_011
        )
        self.assertIsNone(mixed_zero_interval["relativeReductionPercent95Ci"])
        self.assertEqual(
            MONITOR.classify_signal(
                [0.0] * 7,
                [200.0] * 7,
                interval,
                MONITOR.DEFAULT_THRESHOLDS["runnerOccupiedSeconds"],
            ),
            "regression_signal",
        )

    def test_incomplete_completed_attempt_can_be_replaced_when_evidence_completes(self) -> None:
        incomplete = self.write(
            "incomplete-completed.json",
            payload([make_run(1_025, 80, incomplete_step=True)]),
        )
        first = self.invoke(after=incomplete)
        self.assertEqual(first["analysis"]["timingUsableRunCount"], 0)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertFalse(checkpoint["runs"]["1025:1"]["terminalEvidenceComplete"])

        complete = self.write("complete.json", payload([make_run(1_025, 80)]))
        second = self.invoke(after=complete)
        self.assertEqual(second["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1025:1"]["terminalEvidenceComplete"])
        self.assertTrue(checkpoint["runs"]["1025:1"]["timingUsable"])

    def test_timestamped_nonterminal_step_can_be_replaced_when_it_completes(self) -> None:
        incomplete_run = make_run(1_027, 80)
        incomplete_run["jobs"][0]["steps"][0].update(
            {"status": "in_progress", "conclusion": None}
        )
        incomplete = self.write(
            "timestamped-nonterminal-step.json", payload([incomplete_run])
        )
        first = self.invoke(after=incomplete)
        self.assertEqual(first["analysis"]["incompleteStepCount"], 1)
        self.assertEqual(first["analysis"]["timingUsableRunCount"], 0)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertFalse(checkpoint["runs"]["1027:1"]["terminalEvidenceComplete"])

        complete = self.write(
            "timestamped-terminal-step.json", payload([make_run(1_027, 80)])
        )
        second = self.invoke(after=complete)
        self.assertEqual(second["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1027:1"]["terminalEvidenceComplete"])
        self.assertTrue(checkpoint["runs"]["1027:1"]["timingUsable"])

    def test_untimed_neutral_step_is_incomplete(self) -> None:
        run = make_run(1_028, 80)
        run["jobs"][0]["steps"][0].update(
            {
                "status": "completed",
                "conclusion": "neutral",
                "startedAt": None,
                "completedAt": None,
            }
        )
        source = self.write("untimed-neutral-step.json", payload([run]))
        receipt = self.invoke(after=source)
        self.assertEqual(receipt["analysis"]["incompleteStepCount"], 1)
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 0)

    def test_step_timestamps_outside_baseline_bounds_are_rejected(self) -> None:
        base = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
        cases = {
            "before_job_start": {
                "startedAt": timestamp(base + timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=3)),
            },
            "after_job_completion": {
                "startedAt": timestamp(base + timedelta(seconds=3)),
                "completedAt": timestamp(base + timedelta(seconds=83)),
            },
            "completion_before_start": {
                "startedAt": timestamp(base + timedelta(seconds=4)),
                "completedAt": timestamp(base + timedelta(seconds=3)),
            },
            "before_run_creation": {
                "startedAt": timestamp(base - timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=1)),
            },
        }
        for index, (case, step_times) in enumerate(cases.items()):
            with self.subTest(case=case):
                run = make_run(1_030 + index, 80)
                run["createdAt"] = timestamp(base)
                run["jobs"][0].update(
                    {
                        "createdAt": timestamp(base),
                        "startedAt": (
                            None
                            if case == "before_run_creation"
                            else timestamp(base + timedelta(seconds=2))
                        ),
                        "completedAt": timestamp(base + timedelta(seconds=82)),
                    }
                )
                run["jobs"][0]["steps"][0].update(step_times)
                with self.assertRaises(MONITOR.MonitorError):
                    MONITOR.analyze_record(
                        run,
                        "before",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "d" * 64,
                    )

    def test_after_chronology_defect_is_replaceable_and_excluded_from_timing(self) -> None:
        defective = make_run(1_035, 80, attempt=2)
        defective["jobs"][0]["createdAt"] = timestamp(
            MONITOR.parse_timestamp(defective["jobs"][0]["startedAt"])
            + timedelta(seconds=1)
        )
        first_source = self.write("chronology-defect.json", payload([defective]))
        first = self.invoke(after=first_source)
        observation = json.loads(
            self.checkpoint.read_text(encoding="utf-8")
        )["runs"]["1035:2"]

        self.assertFalse(observation["chronologyValid"])
        self.assertEqual(
            observation["chronologyIssueCodes"],
            ["JOB_START_PRECEDES_JOB_CREATION"],
        )
        self.assertFalse(observation["terminalEvidenceComplete"])
        self.assertFalse(observation["timingUsable"])
        self.assertIsNone(observation["criticalPathSeconds"])
        self.assertIsNone(observation["runnerOccupiedSeconds"])
        self.assertIsNone(observation["totalQueueSeconds"])
        self.assertEqual(observation["stageSeconds"], {})
        self.assertEqual(first["analysis"]["chronologyInvalidRunCount"], 1)
        self.assertEqual(
            first["analysis"]["chronologyIssueCodeCounts"],
            {"JOB_START_PRECEDES_JOB_CREATION": 1},
        )

        duplicate = self.invoke(after=first_source)
        self.assertEqual(duplicate["admittedRunCount"], 0)
        self.assertEqual(duplicate["duplicateRunIdCount"], 1)

        normal = make_run(1_036, 40)
        continued_source = self.write(
            "chronology-defect-plus-new.json", payload([defective, normal])
        )
        continued = self.invoke(after=continued_source)
        self.assertEqual(continued["admittedRunCount"], 1)
        self.assertEqual(continued["analysis"]["timingUsableRunCount"], 1)
        self.assertEqual(continued["analysis"]["chronologyInvalidRunCount"], 1)

        corrected = make_run(1_035, 80, attempt=2)
        corrected_source = self.write(
            "corrected-chronology-attempt.json", payload([corrected])
        )
        corrected_receipt = self.invoke(after=corrected_source)
        corrected_observation = json.loads(
            self.checkpoint.read_text(encoding="utf-8")
        )["runs"]["1035:2"]
        self.assertEqual(corrected_receipt["admittedRunCount"], 1)
        self.assertTrue(corrected_observation["terminalEvidenceComplete"])
        self.assertTrue(corrected_observation["chronologyValid"])
        self.assertTrue(corrected_observation["timingUsable"])
        self.assertEqual(corrected_observation["chronologyIssueCodes"], [])

        changed = dict(corrected)
        changed["updatedAt"] = "2026-10-12T00:00:00Z"
        self.assert_input_rejected(
            payload([changed]), name="changed-immutable-chronology-defect.json"
        )

    def test_completed_skipped_step_may_omit_timing(self) -> None:
        run = make_run(1_026, 80)
        step = run["jobs"][0]["steps"][0]
        step.update(
            {
                "status": "completed",
                "conclusion": "skipped",
                "startedAt": None,
                "completedAt": None,
            }
        )
        source = self.write("skipped-step.json", payload([run]))
        receipt = self.invoke(after=source)
        self.assertEqual(receipt["analysis"]["incompleteStepCount"], 0)
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 1)

    def test_missing_attempt_job_total_is_not_timing_usable(self) -> None:
        run = make_run(1_050, 80)
        run.pop("jobsTotalCount")
        source = self.write("missing-total.json", payload([run]))
        receipt = self.invoke(after=source)
        analysis = receipt["analysis"]
        self.assertEqual(analysis["timingUsableRunCount"], 0)
        self.assertEqual(analysis["incompleteAttemptJobSetRunCount"], 1)

    def test_expired_attempt_tombstone_is_distinct_from_timing_data(self) -> None:
        run = make_run(1_075, 80)
        run["tombstone"] = True
        run["jobs"] = []
        run["jobsTotalCount"] = 0
        source = self.write("tombstone.json", payload([run]))
        receipt = self.invoke(after=source)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1075:1"]["tombstone"])
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 0)

    def test_no_comparable_cohort_is_explicit(self) -> None:
        before = self.write("before.json", payload([make_run(1_100, 80)]))
        after = self.write(
            "after.json", payload([make_run(1_200, 80, event="workflow_dispatch")])
        )
        receipt = self.invoke(before, after)
        self.assertIn(
            "no_comparable_workflow_event_runner_cohort",
            receipt["analysis"]["warnings"],
        )

    def test_missing_frozen_baseline_workflow_metadata_blocks_comparison(self) -> None:
        before = self.write(
            "before.json",
            payload([make_run(1_300 + index, 100) for index in range(7)], workflow=None),
        )
        after = self.write(
            "after.json",
            payload(
                [make_run(1_400 + index, 50) for index in range(7)],
                workflow="web-admin-ci.yml",
            ),
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertIn("workflow_cohort_metadata_unverified", cohort["warnings"])

    def test_damaged_checkpoint_fails_without_overwriting_receipt(self) -> None:
        self.checkpoint.write_text("{broken", encoding="utf-8")
        self.receipt.write_text("unchanged", encoding="utf-8")
        source = self.write("input.json", payload([make_run(1_500, 80)]))
        with self.assertRaises(MONITOR.MonitorError):
            MONITOR.main(
                [
                    "--after-input",
                    str(source),
                    "--checkpoint",
                    str(self.checkpoint),
                    "--receipt",
                    str(self.receipt),
                    "--bootstrap-resamples",
                    "1000",
                ]
            )
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_sensitive_diagnostics_are_not_retained(self) -> None:
        source = self.write(
            "input.json",
            payload(
                [
                    make_run(
                        1_600,
                        80,
                        unsafe_step_name=(
                            "Run PRIVATE_DIAGNOSTIC_SENTINEL "
                            "https://example.test/?access_token=hidden"
                        ),
                    )
                ]
            ),
        )
        self.invoke(after=source)
        retained = self.checkpoint.read_text(encoding="utf-8") + self.receipt.read_text(
            encoding="utf-8"
        )
        self.assertNotIn("PRIVATE_DIAGNOSTIC_SENTINEL", retained)
        self.assertNotIn("PRIVATE_URL_SENTINEL", retained)
        self.assertNotIn("hidden", retained)
        self.assertNotIn("API_TOKEN", retained)
        self.assertNotIn("PASSWORD", retained)


if __name__ == "__main__":
    unittest.main()
