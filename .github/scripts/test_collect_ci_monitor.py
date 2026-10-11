import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("ci_live_monitor", Path(__file__).with_name("collect-ci-monitor.py"))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
SHA, TREE, REVISION = "a" * 40, "b" * 40, "c" * 40


def run(attempt=1, status="completed", conclusion="success", run_id=1, minute=0):
    created = datetime(2026, 10, 11, tzinfo=timezone.utc) + timedelta(minutes=minute)
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return {"id": run_id, "run_attempt": attempt, "head_sha": SHA, "event": "pull_request", "status": status, "conclusion": conclusion, "created_at": stamp(created), "run_started_at": stamp(created + timedelta(seconds=1)), "updated_at": stamp(created + timedelta(seconds=10 + attempt))}


def jobs():
    return {"total_count": 1, "jobs": [{"id": 2, "name": "private owner name", "labels": ["ubuntu-latest", "private-host"], "status": "completed", "conclusion": "success", "created_at": "2026-10-11T00:00:00Z", "started_at": "2026-10-11T00:00:01Z", "completed_at": "2026-10-11T00:00:10Z", "steps": [{"number": 1, "name": "Run npm ci TOKEN=secret-value", "status": "completed", "conclusion": "success", "started_at": "2026-10-11T00:00:01Z", "completed_at": "2026-10-11T00:00:09Z"}]}]}


class Reader:
    def __init__(self, latest=None, job_payload=None):
        self.latest = latest or run()
        self.job_payload = job_payload or jobs()
        self.requests = 0
        self.endpoints = []
        self.calls = []
        self.empty = False
        self.gone = False

    def get(self, endpoint, fields=None):
        self.requests += 1
        self.endpoints.append(endpoint)
        self.calls.append((endpoint, dict(fields or {})))
        if endpoint.endswith("/web-admin-ci.yml/runs"):
            return {"total_count": 0 if self.empty else 1, "workflow_runs": [] if self.empty else [self.latest]}
        if "/git/commits/" in endpoint: return {"tree": {"sha": TREE}}
        if "/contents/" in endpoint: return {"sha": REVISION}
        if endpoint.endswith("/jobs"): return self.job_payload
        if "/attempts/" in endpoint:
            result = run(int(endpoint.rsplit("/", 1)[1]), conclusion="failure")
            return result
        if endpoint.endswith("/actions/runs/1"):
            if self.gone: raise M.ReadError("NOT_FOUND")
            return self.latest
        raise AssertionError(endpoint)


class PagingReader(Reader):
    def __init__(self, runs):
        super().__init__()
        self.runs = list(runs)

    def get(self, endpoint, fields=None):
        if endpoint.endswith("/web-admin-ci.yml/runs"):
            self.requests += 1
            self.endpoints.append(endpoint)
            self.calls.append((endpoint, dict(fields or {})))
            page = int((fields or {}).get("page", 1))
            per_page = int((fields or {}).get("per_page", 20))
            start = (page - 1) * per_page
            return {
                "total_count": len(self.runs),
                "workflow_runs": self.runs[start : start + per_page],
            }
        return super().get(endpoint, fields)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.cache = Path(self.directory.name) / "cache.sqlite"

    def tearDown(self): self.directory.cleanup()

    def collect(self, reader):
        return M.collect("twoimo/tzudong", "web-admin-ci.yml", self.cache, reader)

    def test_terminal_cache_uses_one_list_request_and_redacts(self):
        first = self.collect(Reader())
        second = self.collect(Reader())
        self.assertEqual(first["collection"]["apiRequests"], 4)
        self.assertEqual(second["collection"]["apiRequests"], 1)
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        serialized = json.dumps(second)
        for value in ["private owner", "private-host", "secret-value"]: self.assertNotIn(value, serialized)
        self.assertEqual(second["runs"][0]["sourceTree"], TREE)

    def test_attempt_specific_reads_preserve_prior_failure(self):
        reader = Reader(run(2))
        result = self.collect(reader)
        self.assertEqual([r["attempt"] for r in result["runs"]], [1, 2])
        self.assertEqual(result["runs"][0]["conclusion"], "failure")
        self.assertIn("repos/twoimo/tzudong/actions/runs/1/attempts/1/jobs", reader.endpoints)
        self.assertIn("repos/twoimo/tzudong/actions/runs/1/attempts/2/jobs", reader.endpoints)

    def test_incomplete_job_sets_are_rechecked(self):
        payload = jobs(); payload["total_count"] = 2
        first = self.collect(Reader(job_payload=payload))
        second = self.collect(Reader(job_payload=payload))
        self.assertIn("JOB_SET_INCOMPLETE", first["coverage"]["alerts"])
        self.assertEqual(second["collection"]["refreshedJobSets"], 1)

    def test_old_active_run_is_queried_and_404_tombstoned(self):
        self.collect(Reader(run(status="in_progress", conclusion=None)))
        reader = Reader(); reader.empty = True; reader.gone = True
        result = self.collect(reader)
        self.assertIn("RUN_TOMBSTONE", result["coverage"]["alerts"])
        self.assertTrue(result["runs"][0]["tombstone"])
        self.assertIn("repos/twoimo/tzudong/actions/runs/1", reader.endpoints)

    def test_scope_mismatch_does_not_replace_cache(self):
        self.collect(Reader())
        with self.assertRaisesRegex(M.ReadError, "CACHE_SCOPE_MISMATCH"):
            M.collect("someone/else", "web-admin-ci.yml", self.cache, Reader())
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(db.execute("SELECT repository FROM scope").fetchone()[0], "twoimo/tzudong")

    def test_malformed_job_dates_are_not_persisted(self):
        payload = jobs(); payload["jobs"][0]["completed_at"] = "private-diagnostic"
        with self.assertRaisesRegex(M.ReadError, "INVALID_JOB_TIME"):
            self.collect(Reader(job_payload=payload))
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM runs").fetchone()[0], 0)

    def test_incremental_overlap_window_uses_bounded_pagination(self):
        all_runs = [run(run_id=100 + index, minute=44 - index) for index in range(45)]
        reader = PagingReader(all_runs)
        first = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache, reader, limit=20, max_pages=3
        )
        self.assertIn("BOUNDED_RECENT_WINDOW", first["coverage"]["alerts"])
        self.assertEqual(first["coverage"]["listPages"], 1)

        second_reader = PagingReader(all_runs)
        second = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            second_reader,
            limit=20,
            max_pages=3,
        )
        self.assertEqual(second["coverage"]["listPages"], 3)
        self.assertEqual(second["coverage"]["uniqueListedRunCount"], 45)
        self.assertTrue(second["coverage"]["incrementalWindowComplete"])
        self.assertNotIn("RECENT_WINDOW_TRUNCATED", second["coverage"]["alerts"])
        pages = [fields["page"] for endpoint, fields in second_reader.calls if endpoint.endswith("/runs") and "workflows" in endpoint]
        self.assertEqual(pages, [1, 2, 3])
        list_fields = [
            fields
            for endpoint, fields in second_reader.calls
            if endpoint.endswith("/runs") and "workflows" in endpoint
        ]
        self.assertTrue(all(fields["created"].startswith(">=2026-10-09T") for fields in list_fields))

    def test_truncated_incremental_window_does_not_advance_watermark(self):
        initial_runs = [run(run_id=200 + index, minute=19 - index) for index in range(20)]
        first = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader(initial_runs),
            limit=20,
            max_pages=2,
        )
        watermark = first["coverage"]["watermarkAfter"]
        expanded_runs = [run(run_id=999, minute=30)] + [
            run(run_id=300 + index, minute=29 - index) for index in range(60)
        ]
        second = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader(expanded_runs),
            limit=20,
            max_pages=2,
        )
        self.assertIn("RECENT_WINDOW_TRUNCATED", second["coverage"]["alerts"])
        self.assertFalse(second["coverage"]["incrementalWindowComplete"])
        self.assertFalse(second["coverage"]["watermarkAdvanced"])
        self.assertEqual(second["coverage"]["watermarkBefore"], watermark)
        self.assertEqual(second["coverage"]["watermarkAfter"], watermark)
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(
                db.execute("SELECT value FROM meta WHERE key='watermark'").fetchone()[0],
                watermark,
            )

    def test_pagination_and_overlap_bounds_fail_closed(self):
        with self.assertRaisesRegex(M.ReadError, "INVALID_PAGE_BOUND"):
            M.collect(
                "twoimo/tzudong",
                "web-admin-ci.yml",
                self.cache,
                Reader(),
                max_pages=11,
            )
        with self.assertRaisesRegex(M.ReadError, "INVALID_OVERLAP_BOUND"):
            M.collect(
                "twoimo/tzudong",
                "web-admin-ci.yml",
                self.cache,
                Reader(),
                overlap_hours=0,
            )

    def test_list_total_smaller_than_page_fails_closed(self):
        class InvalidListReader(Reader):
            def get(self, endpoint, fields=None):
                if endpoint.endswith("/web-admin-ci.yml/runs"):
                    return {"total_count": 0, "workflow_runs": [run()]}
                return super().get(endpoint, fields)

        with self.assertRaisesRegex(M.ReadError, "INVALID_RUN_LIST"):
            self.collect(InvalidListReader())


if __name__ == "__main__": unittest.main()
