import importlib.util
import unittest
from pathlib import Path


def load(name):
    path = Path(__file__).resolve().parents[1] / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CohortShadowTests(unittest.TestCase):
    def test_shadow_comparison_blocks_live_writes_until_the_cohort_is_complete(self):
        score = load("popularity_score_batch")
        freshness = score.decay(10, 0.5, 460)
        visits = score.visits_multiplier(["abc123DEF45", "abc123DEF45"], 0.25)
        self.assertEqual(visits, 1)
        signals = {"freshness": freshness, "visit_multiplier": visits}
        incomplete = score.compare_cohort_shadow([
            {"identity": "shop:a", "operational_score": 4, "candidate_signals": signals},
            {"identity": "shop:b", "operational_score": None, "candidate_signals": None},
        ])
        self.assertEqual(incomplete["summary"]["count"], 2)
        self.assertEqual(incomplete["summary"]["differ_count"], 1)
        self.assertFalse(incomplete["summary"]["live_write_allowed"])
        with self.assertRaises(ValueError):
            score.refuse_operational_write(incomplete["summary"])

        complete = score.compare_cohort_shadow([
            {"identity": "shop:a", "operational_score": 4, "candidate_signals": signals},
            {"identity": "shop:b", "operational_score": None, "candidate_signals": signals},
        ])
        self.assertTrue(complete["summary"]["live_write_allowed"])
        self.assertEqual(complete["records"][0]["operational_score"], 4)
        self.assertEqual(complete["records"][0]["candidate_freshness"], freshness)
        self.assertEqual(complete["records"][0]["candidate_visit_multiplier"], visits)
        self.assertNotIn("multiplied_score", complete["records"][0])
        kept = score.refuse_operational_write(complete["summary"])
        self.assertIsNone(kept["popularity_score"])
        self.assertIsNone(kept["popularity_tier"])
        self.assertFalse(kept["overwrites_operational_values"])
        self.assertFalse(kept["writes_hosted_database"])

        row = score.build_popularity_row(
            canonical_key="shop:a",
            video_ids=["abc123DEF45"],
            days_since_publish=10,
            review_count=0,
            scoring_version="score-v1",
            cohort_version="cohort-a",
            computed_at="2026-10-17T04:00:00.000Z",
            gamma=0.25,
            source_revision=1,
        )
        self.assertIsNone(row["popularity_score"])
        self.assertIsNone(row["popularity_tier"])

        sql = Path(__file__).resolve().parents[3].joinpath(
            "supabase", "migrations", "20261017140000_restaurant_popularity_shadow.sql",
        ).read_text(encoding="utf-8").lower()
        self.assertIn("restaurant_popularity_shadow", sql)
        self.assertNotIn("on delete cascade", sql)
        self.assertNotIn("grant ", sql)
        self.assertNotIn("popularity_tier", sql)


if __name__ == "__main__":
    unittest.main()
