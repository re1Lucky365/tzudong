"""Tick integration: freeze boundary, deduplication and preserved state."""
import argparse
import fcntl
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


TICK = module("ci_tick", "run-ci-monitor.py")
FIXTURE = module("ci_test_fixtures", "test_monitor_ci_performance.py")


class CiMonitorTickTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.baseline = FIXTURE.payload([FIXTURE.make_run(1, 10)])
        self.baseline["capturedAtUtc"] = "2026-10-10T10:01:31Z"
        self.baseline_path = self.root / "baseline.json"
        TICK.MONITOR.atomic_write_json(self.baseline_path, self.baseline)
        self.export = FIXTURE.payload([FIXTURE.make_run(2, 10, conclusion="failure")])
        self.export["capturedAtUtc"] = "2026-10-10T10:03:00Z"
        self.export["coverage"] = {"alerts": ["RECENT_WINDOW_TRUNCATED"]}
        self.input_path = self.root / "input.json"
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        self.args = argparse.Namespace(
            state_dir=self.root / "state", baseline=self.baseline_path,
            baseline_sha256=TICK.MONITOR.sha256_file(self.baseline_path), input=self.input_path,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_older_pagination_catch_up_never_becomes_after_sample(self):
        historical = FIXTURE.make_run(3, 10)
        historical.update(startedAt="2026-10-09T00:00:01Z", createdAt="2026-10-09T00:00:00Z")
        payload = {"workflow": self.export["workflow"], "runs": [self.baseline["runs"][0], historical, self.export["runs"][0]]}
        current = TICK.future_observations(payload, self.baseline)
        self.assertEqual([r["id"] for r in current["runs"]], [2])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)

    def test_new_attempt_of_old_run_is_observed_when_attempt_start_is_after_freeze(self):
        retry = dict(self.baseline["runs"][0], attempt=2, startedAt="2026-10-11T00:00:00Z")
        current = TICK.future_observations({"workflow": self.export["workflow"], "runs": [retry]}, self.baseline)
        self.assertEqual(len(current["runs"]), 1)

    def test_offline_tick_alerts_once_and_reuses_completed_attempts(self):
        first = TICK.tick(self.args)
        second = TICK.tick(self.args)
        self.assertTrue(first["shouldNotify"])
        self.assertIn("failure:2:1", first["newAlertKeys"])
        self.assertFalse(second["shouldNotify"])
        self.assertEqual(second["admittedAttemptCount"], 0)
        self.assertEqual(second["duplicateAttemptCount"], 2)
        self.assertEqual(second["remoteMutations"], 0)
        self.assertEqual(second["modelsInvokedByProgram"], 0)
        self.assertEqual(second["mode"], "offline_replay")
        self.assertEqual(second["apiRequestsThisTick"], 0)

    def test_baseline_and_configuration_changes_fail_without_overwriting_checkpoint(self):
        TICK.tick(self.args)
        checkpoint = self.args.state_dir / "analysis-state.json"
        previous = checkpoint.read_bytes()
        self.args.baseline_sha256 = "0" * 64
        with self.assertRaisesRegex(TICK.TickError, "BASELINE_HASH_MISMATCH"):
            TICK.tick(self.args)
        self.assertEqual(checkpoint.read_bytes(), previous)
        self.args.baseline_sha256 = TICK.MONITOR.sha256_file(self.baseline_path)
        config = self.args.state_dir / "monitor-config.json"
        value = TICK.MONITOR.load_json(config); value["limit"] = 99
        TICK.MONITOR.atomic_write_json(config, value)
        with self.assertRaisesRegex(TICK.TickError, "MONITOR_CONFIG_CHANGED"):
            TICK.tick(self.args)
        self.assertEqual(checkpoint.read_bytes(), previous)

    def test_an_existing_tick_lock_blocks_duplicate_execution(self):
        self.args.state_dir.mkdir()
        with (self.args.state_dir / "tick.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(TICK.TickError, "MONITOR_ALREADY_RUNNING"):
                TICK.tick(self.args)

    def test_lost_last_receipt_preserves_checkpoint_and_retries_without_readmitting(self):
        original = TICK.MONITOR.atomic_write_json
        def fail_last(path, value):
            if path.name == "last-tick.json":
                raise OSError("fixture receipt write interruption")
            return original(path, value)
        with patch.object(TICK.MONITOR, "atomic_write_json", side_effect=fail_last):
            with self.assertRaises(OSError):
                TICK.tick(self.args)
        self.assertTrue((self.args.state_dir / "analysis-state.json").exists())
        recovered = TICK.tick(self.args)
        self.assertEqual(recovered["admittedAttemptCount"], 0)
        self.assertEqual(recovered["duplicateAttemptCount"], 2)
        self.assertIn("failure:2:1", recovered["newAlertKeys"])
        self.assertFalse(TICK.tick(self.args)["shouldNotify"])

    def test_active_attempt_can_become_tombstone_without_becoming_a_time_sample(self):
        active = FIXTURE.make_run(2, 10, status="in_progress")
        active["conclusion"] = None
        self.export["runs"] = [active]
        self.export["coverage"] = {"alerts": []}
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        self.assertFalse(TICK.tick(self.args)["shouldNotify"])
        self.export["runs"] = [dict(active, status="missing", conclusion="stale", tombstone=True, jobs=[], jobsTotalCount=0)]
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        observed = TICK.tick(self.args)
        self.assertIn("failure:2:1", observed["newAlertKeys"])
        analysis = TICK.MONITOR.load_json(Path(observed["receiptPath"]))["analysis"]
        self.assertEqual(analysis["timingUsableRunCount"], 1)  # frozen baseline only
        self.assertEqual(analysis["runConclusionCounts"]["stale"], 1)

    def test_driver_budget_covers_two_thousand_collector_attempts_and_baseline(self):
        TICK.tick(self.args)
        config = TICK.MONITOR.load_json(self.args.state_dir / "monitor-config.json")
        self.assertGreaterEqual(config["maximumInputAttempts"], (20 * 5 + 100) * 10 + config["maximumBaselineAttempts"])
        self.assertLessEqual(config["maximumInputAttempts"], TICK.MONITOR.MAX_INPUT_RUNS)


if __name__ == "__main__":
    unittest.main()
