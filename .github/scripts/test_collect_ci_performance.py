import copy
import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "ci_performance_collector", Path(__file__).with_name("collect-ci-performance.py")
)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def complete_run(run_id: int, minute: int) -> dict:
    created = datetime(2026, 10, 11, tzinfo=timezone.utc) + timedelta(minutes=minute)
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return {
        "id": run_id,
        "attempt": 1,
        "event": "pull_request",
        "status": "completed",
        "conclusion": "success",
        "headSha": "a" * 40,
        "createdAt": stamp(created),
        "startedAt": stamp(created + timedelta(seconds=1)),
        "updatedAt": stamp(created + timedelta(seconds=10)),
        "jobs": [
            {
                "id": run_id * 10,
                "name": "Ubuntu npm",
                "status": "completed",
                "conclusion": "success",
                "createdAt": stamp(created),
                "startedAt": stamp(created + timedelta(seconds=1)),
                "completedAt": stamp(created + timedelta(seconds=9)),
                "runnerLabels": ["ubuntu-latest"],
                "steps": [
                    {
                        "number": 1,
                        "name": "Run npm ci",
                        "status": "completed",
                        "conclusion": "success",
                        "startedAt": stamp(created + timedelta(seconds=2)),
                        "completedAt": stamp(created + timedelta(seconds=8)),
                    }
                ],
            }
        ],
    }


def replay_payloads():
    successful = [complete_run(run_id, 20 - run_id) for run_id in range(1, 8)]
    excluded_run = complete_run(8, 12)
    excluded_run["conclusion"] = "failure"
    observations = [
        {
            "run": excluded_run,
            "reasonCodes": ["run_conclusion_failure"],
            "censored": True,
        }
    ]
    ordered = sorted(
        successful + [excluded_run],
        key=lambda run: (run["createdAt"], run["id"]),
        reverse=True,
    )
    collection = {
        "schema": f"{M.SCHEMA_VERSION}/collection",
        "fetchedRunCount": 8,
        "successfulRunCount": 7,
        "excludedRunCount": 1,
        "orderedRunIds": [run["id"] for run in ordered],
    }
    successful_payload = {
        "schema": f"{M.SCHEMA_VERSION}/successful-runs",
        "runs": successful,
    }
    excluded_payload = {
        "schema": f"{M.SCHEMA_VERSION}/excluded-observations",
        "observations": observations,
    }
    return collection, successful_payload, excluded_payload


class CollectorAdmissionTests(unittest.TestCase):
    def test_success_requires_every_non_skipped_step_to_be_terminal_and_timed(self):
        incomplete = complete_run(1, 0)
        step = incomplete["jobs"][0]["steps"][0]
        step.update(status="in_progress", conclusion=None, completedAt=None)
        self.assertEqual(
            M.exclusion_reasons(incomplete),
            ["incomplete_step", "missing_step_timing"],
        )

        missing_conclusion = complete_run(3, 0)
        missing_conclusion["jobs"][0]["steps"][0]["conclusion"] = None
        self.assertEqual(M.exclusion_reasons(missing_conclusion), ["incomplete_step"])

        skipped = complete_run(2, 0)
        skipped["jobs"][0]["steps"][0].update(
            status="completed", conclusion="skipped", startedAt=None, completedAt=None
        )
        self.assertEqual(M.exclusion_reasons(skipped), [])

        active_skipped = complete_run(4, 0)
        active_skipped["jobs"][0]["steps"][0].update(
            status="in_progress", conclusion="skipped", startedAt=None, completedAt=None
        )
        self.assertEqual(M.exclusion_reasons(active_skipped), ["incomplete_step"])

    def test_success_rejects_malformed_and_out_of_boundary_timing(self):
        cases = {
            "malformed_run": lambda run: run.update(createdAt="malformed-time"),
            "run_order": lambda run: run.update(startedAt="2026-10-10T23:59:59Z"),
            "job_before_run": lambda run: run["jobs"][0].update(
                createdAt="2026-10-10T23:59:59Z"
            ),
            "job_after_run": lambda run: run["jobs"][0].update(
                completedAt="2026-10-11T00:00:10.500000Z"
            ),
            "step_before_job": lambda run: run["jobs"][0]["steps"][0].update(
                startedAt="2026-10-11T00:00:00.500000Z"
            ),
            "step_after_job": lambda run: run["jobs"][0]["steps"][0].update(
                completedAt="2026-10-11T00:00:09.500000Z"
            ),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                candidate = complete_run(10, 0)
                mutate(candidate)
                reasons = M.exclusion_reasons(candidate)
                self.assertTrue(
                    {"malformed_timing", "invalid_timing_order"} & set(reasons),
                    reasons,
                )

        partial_skipped = complete_run(11, 0)
        partial_skipped["jobs"][0]["steps"][0].update(
            conclusion="skipped", completedAt=None
        )
        self.assertIn("missing_step_timing", M.exclusion_reasons(partial_skipped))

        missing_run = complete_run(12, 0)
        missing_run["createdAt"] = None
        self.assertIn("missing_run_timing", M.exclusion_reasons(missing_run))

        missing_job = complete_run(13, 0)
        missing_job["jobs"][0]["createdAt"] = None
        self.assertIn("missing_job_timing", M.exclusion_reasons(missing_job))

    def test_replay_collection_summary_is_bound_to_both_observation_payloads(self):
        collection, successful, excluded = replay_payloads()
        M.validate_replay_inputs(collection, successful, excluded)

        mutations = (
            ("fetchedRunCount", 9),
            ("successfulRunCount", 6),
            ("excludedRunCount", 0),
            ("orderedRunIds", list(reversed(collection["orderedRunIds"]))),
        )
        for key, value in mutations:
            with self.subTest(key=key):
                changed = copy.deepcopy(collection)
                changed[key] = value
                with self.assertRaises(M.CollectionError):
                    M.validate_replay_inputs(changed, successful, excluded)

        different_capture = copy.deepcopy(successful)
        different_capture["runs"][0]["id"] = 999
        with self.assertRaises(M.CollectionError):
            M.validate_replay_inputs(collection, different_capture, excluded)


if __name__ == "__main__":
    unittest.main()
