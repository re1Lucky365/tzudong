import unittest
from pathlib import Path
import importlib.util


EVAL_SCRIPTS = Path(__file__).resolve().parents[1]
CRAWL_SCRIPTS = Path(__file__).resolve().parents[3] / "restaurant-crawling" / "scripts"


def load(name, root=EVAL_SCRIPTS):
    path = root / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EvidenceFollowOnTests(unittest.TestCase):
    def test_place_names_drop_raw_ocr_and_keep_short_names(self):
        names = load("detected_place_names", CRAWL_SCRIPTS)
        projected = names.project_detected_place_names(
            {
                "video_id": "abc123DEF45",
                "raw_ocr": "간판 전체 문장",
                "ocr_regions": [
                    {"zone": "storefront_sign", "text": "1300원 회전초밥"},
                    {"zone": "branch", "text": "용전점"},
                ],
            }
        )
        self.assertNotIn("raw_ocr", projected)
        self.assertEqual(projected["detected_shop_name"], "1300원 회전초밥")
        self.assertEqual(projected["detected_branch_name"], "용전점")
        with self.assertRaises(ValueError):
            names.project_detected_place_names({"ocr_regions": [{"zone": "storefront_sign", "text": "02-123-4567"}]})

    def test_query_plan_executes_only_exact_stages(self):
        plan_mod = load("naver_query_plan")
        plan = plan_mod.build_naver_query_plan(
            origin_name="할머니칼국수",
            road_address="서울특별시 중구 세종대로 1",
            jibun_address="서울 중구 태평로1가 31",
            sigungu="중구",
            keyword="칼국수",
            category="한식",
            historical_name="원조할머니칼국수",
            admin_dong="명동",
        )
        self.assertEqual([stage["stage"] for stage in plan], [1, 2, 3, 4, 5])
        self.assertEqual([stage["execute"] for stage in plan], [True, True, True, False, False])
        self.assertEqual(len(plan_mod.executable_exact_queries(plan)), 3)
        broad = [stage for stage in plan if stage["stage"] in (4, 5)]
        self.assertTrue(all(stage["kind"] == "broad" and stage["auto_confirm"] is False for stage in broad))
        self.assertEqual([stage["text"] for stage in broad], ["중구 칼국수 한식", "원조할머니칼국수 명동"])
        executed = plan_mod.executable_exact_queries(plan)
        self.assertTrue(all(stage["text"] not in executed for stage in broad))
        self.assertTrue(all(stage["stage"] <= 5 for stage in plan))
        self.assertNotIn(6, [stage["stage"] for stage in plan])

    def test_search_miss_is_not_closed_store(self):
        identity = load("evidence_identity")
        decision = identity.resolve_automatic_identity(
            query_stage=1,
            search_miss=True,
            evidence_families=["mois_public_license_closed"],
        )
        self.assertEqual(decision["state"], "needs_review")
        self.assertFalse(decision["auto_closed_store"])
        broad = identity.resolve_automatic_identity(
            query_stage=4,
            evidence_families=["lexical_name_match", "bounded_spatial_proximity"],
        )
        self.assertEqual(broad["state"], "needs_review")
        complete = {
            "ledgerId": "license-100",
            "businessAddress": "서울특별시 중구 세종대로 1",
            "effectiveOn": "2024-03-01",
            "branchDistinction": "본점",
            "sourceUpdatedOn": "2026-10-01",
        }
        closed = identity.resolve_automatic_identity(query_stage=1, closure_record=complete)
        self.assertEqual(closed["state"], "closure_candidate")
        self.assertFalse(closed["auto_closed_store"])
        with self.assertRaises(ValueError):
            identity.resolve_automatic_identity(query_stage=1, closure_record={**complete, "ledgerId": ""})
        with self.assertRaises(ValueError):
            identity.resolve_automatic_identity(query_stage=1, closure_record={**complete, "effectiveOn": "2024-02-31"})

    def test_collection_import_cannot_overwrite_review_status(self):
        ledger = load("review_ledger_import")
        with self.assertRaises(ValueError):
            ledger.merge_collection_row(
                {"frame_id": "frm-1", "moderation_status": "approved"},
                {"frame_id": "frm-1", "moderation_status": "pending", "content_sha256": "a" * 64},
            )
        with self.assertRaises(ValueError):
            ledger.merge_collection_row(
                {"frame_id": "frm-1", "moderation_status": "approved"},
                {"frame_id": "frm-1", "moderation_status": "rejected"},
            )
        with self.assertRaises(ValueError):
            ledger.merge_collection_row(
                {"frame_id": "frm-1", "moderation_status": "rejected"},
                {"frame_id": "frm-1", "moderation_status": "approved"},
            )
        merged = ledger.merge_collection_row(
            {"frame_id": "frm-1", "moderation_status": "approved", "origin_name": "옛이름"},
            {"frame_id": "frm-1", "moderation_status": "approved", "origin_name": "새이름"},
        )
        self.assertEqual(merged["moderation_status"], "approved")
        self.assertEqual(merged["origin_name"], "새이름")

    def test_score_batch_keeps_formula_parts_unmultiplied(self):
        score = load("popularity_score_batch")
        self.assertAlmostEqual(score.hyperbolic_half_life_days(), 2000 / 3)
        self.assertFalse(score.hyperbolic_half_life_days() == 460)
        self.assertEqual(score.decay(460, 0.5, 460), 0.75)
        self.assertEqual(score.decay(0, 0.5, 460), 1)
        self.assertAlmostEqual(score.decay(1825, 0.5, 460), 549 / 914)
        self.assertAlmostEqual(score.hyperbolic_decay(460), 100 / 169)
        with self.assertRaises(ValueError):
            score.hyperbolic_decay(10, 0)
        with self.assertRaises(ValueError):
            score.visits_multiplier(["https://www.youtube.com/watch?v=abc123DEF45"], 0.25)
        row = score.build_popularity_row(
            canonical_key="shop:video",
            video_ids=["abc123DEF45", "abc123DEF45"],
            days_since_publish=460,
            review_count=None,
            scoring_version="score-v1",
            cohort_version="cohort-a",
            computed_at="2026-10-17T04:00:00.000Z",
            gamma=0.25,
            source_revision=3,
        )
        self.assertEqual(row["source_revision"], 3)
        self.assertIsNone(row["popularity_score"])
        self.assertIsNone(row["popularity_tier"])
        self.assertNotIn("signals", row)
        self.assertNotIn("multiplied_score", row)
        self.assertFalse(row["writes_hosted_database"])
        self.assertEqual(score.visits_multiplier(["abc123DEF45", "abc123DEF45"], 0.25), 1)
        with self.assertRaises(ValueError):
            score.decay(-1, 0.5, 460)
        with self.assertRaises(ValueError):
            score.decay(1, -0.1, 460)
        with self.assertRaises(ValueError):
            score.visits_multiplier(["abc123DEF45"], -0.01)

    def test_migration_does_not_cascade_or_force_source_observed(self):
        sql_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "20261017043000_evidence_frames_and_popularity.sql"
        sql = sql_path.read_text(encoding="utf-8").lower()
        self.assertIn("timestamp_ms bigint", sql)
        self.assertIn("references public.restaurants (id)", sql)
        self.assertNotIn("on delete cascade", sql)
        self.assertNotIn("using (true)", sql)
        self.assertNotIn("evidence_level = 'source_observed'", sql)
        self.assertNotIn("alter table public.restaurants", sql)
        self.assertNotIn("content_sha256 <> frame_id", sql)
        self.assertNotRegex(sql, r"\binsert\s+into\b")
        self.assertNotRegex(sql, r"\bupdate\s+")
        self.assertNotIn("timestamp_ms integer", sql)
        score_source = (Path(__file__).resolve().parents[1] / "popularity_score_batch.py").read_text(encoding="utf-8").lower()
        self.assertNotIn("bayesian", score_source)
        self.assertNotIn("percentile", score_source)
        self.assertNotIn("0.2 *", score_source)


if __name__ == "__main__":
    unittest.main()
