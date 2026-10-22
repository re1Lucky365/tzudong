import importlib.util
import unittest
from pathlib import Path


def load():
    path = Path(__file__).resolve().parents[1] / "evaluation_results_boundary.py"
    spec = importlib.util.spec_from_file_location("evaluation_results_boundary", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EvaluationResultsBoundaryTests(unittest.TestCase):
    def test_recollect_json_drops_frames_and_popularity_score(self):
        omit = load().omit_satellite_fields
        self.assertIsNone(omit(None))
        cleaned = omit({
            "location_match_TF": {"eval_value": True},
            "evidence_frames": [{"frame_id": "frm-1"}],
            "restaurant_evidence_frames": [{"frame_id": "frm-2"}],
            "popularity_score": 9,
            "popularity_tier": "fire",
            "restaurant_popularity_metrics": {"popularity_score": 9},
        })
        self.assertEqual(cleaned, {"location_match_TF": {"eval_value": True}})
        self.assertNotIn("popularity_score", cleaned)
        self.assertNotIn("evidence_frames", cleaned)
        with self.assertRaises(ValueError):
            omit(["not-an-object"])


if __name__ == "__main__":
    unittest.main()
