#!/usr/bin/env python3
"""Hash the review package without making the map self-referential."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
FILES = [
    "README.md",
    "build_artifact_map.py",
    "build_carrier.py",
    "local-replay-v1.json",
    "review-carrier-v1.json",
    "run_local_replay.py",
    "verify_carrier.py",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    artifacts = [
        {"path": name, "bytes": (HERE / name).stat().st_size, "sha256": digest(HERE / name)}
        for name in FILES
    ]
    body = {
        "schemaVersion": 1,
        "sourceCommit": "056a86600f412eb42df4304e3206841679012f3e",
        "artifacts": artifacts,
    }
    target = HERE / "artifact-map-v1.json"
    target.write_text(json.dumps(body, indent=2) + "\n")
    (HERE / "artifact-map-v1.sha256").write_text(digest(target) + "  artifact-map-v1.json\n")
    print(json.dumps({"status": "built", "artifacts": len(artifacts)}))


if __name__ == "__main__":
    main()
