import unittest
from pathlib import Path


def load():
    path = Path(__file__).resolve().parents[1] / "caption_file_contract.py"
    import importlib.util
    spec = importlib.util.spec_from_file_location("caption_file_contract", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CaptionFileContractTests(unittest.TestCase):
    def test_frame_count_matches_file_names_and_keeps_frames(self):
        contract = load().caption_file_contract([
            "/frames/abc/7.50.webp",
            "/frames/abc/8.00.webp",
        ])
        record = {
            "video_id": "abc123DEF45",
            "recollect_id": 0,
            "start_sec": 7.5,
            "end_sec": 17.5,
            "rank": 1,
            "frames": ["/frames/abc/7.50.webp", "/frames/abc/8.00.webp"],
        }
        record.update(contract)
        self.assertEqual(record["file_names"], ["7.50.webp", "8.00.webp"])
        self.assertEqual(record["frame_count"], len(record["file_names"]))
        self.assertEqual(record["frames"][0], "/frames/abc/7.50.webp")
        writer = Path(__file__).resolve().parents[1].joinpath("06-frame-caption.py").read_text(encoding="utf-8")
        self.assertIn('result.update(caption_file_contract(frame_paths))', writer)


if __name__ == "__main__":
    unittest.main()
