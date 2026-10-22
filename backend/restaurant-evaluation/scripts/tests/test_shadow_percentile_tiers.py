import importlib.util
import unittest
from pathlib import Path


def load():
    path = Path(__file__).resolve().parents[1] / "popularity_score_batch.py"
    spec = importlib.util.spec_from_file_location("popularity_score_batch", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def member(identity, computed_at, visit, freshness, signals=True):
    return {
        "identity": identity,
        "computed_at": computed_at,
        "operational_score": 4,
        "candidate_signals": None if not signals else {
            "freshness": freshness,
            "visit_multiplier": visit,
        },
    }


class ShadowPercentileTierTests(unittest.TestCase):
    def test_shadow_percentile_tiers_use_nearest_rank(self):
        score = load()
        empty = score.assign_shadow_percentile_tiers([])
        self.assertEqual(empty["records"], [])
        self.assertEqual(empty["summary"]["percentile_method"], "nearest-rank")
        self.assertIsNone(empty["summary"]["live_operational_score"])
        self.assertIsNone(empty["summary"]["live_popularity_tier"])

        single = score.assign_shadow_percentile_tiers([
            member("only", "2026-10-17T04:00:00.000Z", 1, 0.5),
        ])
        self.assertEqual(single["records"][0]["shadow_tier"], "fire")
        self.assertIsNone(single["records"][0]["popularity_score"])
        self.assertIsNone(single["records"][0]["restaurants_popularity_tier"])
        self.assertNotIn("multiplied_score", single["records"][0])

        moment = "2026-10-17T04:00:00.000Z"
        cohort = [
            member(f"m{index}", moment, index / 100, 0.5)
            for index in range(20)
        ]
        ranked = score.assign_shadow_percentile_tiers(cohort)
        by_id = {row["identity"]: row["shadow_tier"] for row in ranked["records"]}
        self.assertEqual(by_id["m15"], "standard")
        self.assertEqual(by_id["m16"], "rainbow")
        self.assertEqual(by_id["m18"], "fire")
        self.assertEqual(ranked["summary"]["percentile_method"], "nearest-rank")
        self.assertTrue(all(row["popularity_score"] is None for row in ranked["records"]))

        other = "2026-10-16T04:00:00.000Z"
        mixed = score.assign_shadow_percentile_tiers(
            cohort + [member("later", other, 50, 1)],
        )
        mixed_by_id = {row["identity"]: row["shadow_tier"] for row in mixed["records"]}
        self.assertEqual(mixed_by_id["m0"], "standard")
        self.assertEqual(mixed_by_id["later"], "fire")

        blocked = score.assign_shadow_percentile_tiers([
            member("ready", moment, 1, 0.5),
            member("missing", moment, 2, 0.5, signals=False),
        ])
        self.assertIsNone(blocked["records"][0]["shadow_tier"])
        self.assertIsNone(blocked["records"][1]["shadow_tier"])
        self.assertIsNone(blocked["records"][0]["popularity_score"])

        sql = Path(__file__).resolve().parents[3].joinpath(
            "supabase", "migrations", "20261017160000_restaurant_popularity_shadow_tier.sql",
        ).read_text(encoding="utf-8").lower()
        self.assertIn("popularity_tier", sql)
        self.assertNotIn("on delete cascade", sql)
        self.assertNotIn("grant ", sql)


if __name__ == "__main__":
    unittest.main()
