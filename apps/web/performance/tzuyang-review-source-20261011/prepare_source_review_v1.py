"""Prepare private, source-bound semantic review inputs; never mutate restaurant data."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse, parse_qs

SOURCE_HASH = "b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8"
INDEX_HASH = "76fc36cbe3fda49cdc8649c22f9ab85e1de94d7b6cb428d63c50c3cd69a6b3a8"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def video_id(url):
    parsed = urlparse(str(url or ""))
    if parsed.hostname == "youtu.be":
        value = parsed.path.strip("/")
    elif parsed.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        value = parse_qs(parsed.query).get("v", [""])[0]
    else:
        value = ""
    return value if re.fullmatch(r"[A-Za-z0-9_-]{11}", value) else None


def safe_text(value):
    value = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[CONTACT]", str(value or ""), flags=re.I)
    return re.sub(r"(?:\+82[ -]?)?0(?:1[016789]|2|[3-6][1-5])[ -]?\d{3,4}[ -]?\d{4}", "[CONTACT]", value)


def prepare(private, source_base):
    source_raw = (private / "restaurants-review-snapshot-v1.json").read_bytes()
    index_raw = (private / "source-availability-index-v8.json").read_bytes()
    if sha(source_raw) != SOURCE_HASH or sha(index_raw) != INDEX_HASH:
        raise ValueError("SOURCE_BINDING_DENIED")
    rows = json.loads(source_raw)
    index = json.loads(index_raw)["rows"]
    if len(index) != 161 or len({r["key"] for r in index}) != 161:
        raise ValueError("SOURCE_COVERAGE_DENIED")
    groups = defaultdict(list)
    for item in index:
        row = rows[int(item["key"][1:])]
        if row["status"] != "approved" or row["channel_name"] != "tzuyang" or video_id(row["youtube_link"]) != item["videoId"]:
            raise ValueError("RECORD_IDENTITY_DENIED")
        groups[item["videoId"]].append((item, row))
    jobs, excluded, languages = [], [], Counter()
    for identifier, group in groups.items():
        transcript = next(s for s in group[0][0]["sources"] if s["kind"] == "transcript")
        path = source_base / "transcript" / (identifier + ".jsonl")
        raw = path.read_bytes()
        if path.resolve() != Path(transcript["path"]).resolve() or sha(raw) != transcript["sha256"]:
            raise ValueError("TRANSCRIPT_SOURCE_DRIFT")
        records = [json.loads(line) for line in raw.splitlines() if line.strip()]
        admitted = []
        for record in records:
            if video_id(record.get("youtube_link")) != identifier or record.get("channel_name", "tzuyang") != "tzuyang":
                continue
            segments = record.get("transcript")
            if not isinstance(segments, list) or not segments:
                continue
            valid = []
            for segment in segments:
                start, text = segment.get("start"), segment.get("text")
                if not isinstance(start, (int, float)) or isinstance(start, bool) or not math.isfinite(start) or start < 0 or not isinstance(text, str) or not text.strip():
                    valid = []
                    break
                valid.append({"segment": len(valid), "startSeconds": start, "text": safe_text(text)})
            if valid:
                admitted.append((record, valid))
        if not admitted:
            excluded.extend({"key": item["key"], "reason": "TRANSCRIPT_EMPTY_OR_IDENTITY_UNCONFIRMED"} for item, _ in group)
            continue
        # Preserve every record hash in the source binding, select the last complete
        # collected version deterministically; never merge contradictory tracks.
        record, segments = admitted[-1]
        metadata_raw = (source_base / "meta" / (identifier + ".jsonl")).read_bytes()
        metadata = [json.loads(line) for line in metadata_raw.splitlines() if line.strip()]
        exact_meta = [r for r in metadata if r.get("channel_name") == "tzuyang" and video_id(r.get("youtube_link")) == identifier]
        if not exact_meta:
            excluded.extend({"key": item["key"], "reason": "VIDEO_METADATA_IDENTITY_UNCONFIRMED"} for item, _ in group)
            continue
        language = record.get("language", "not_recorded")
        languages[str(language)] += 1
        content = {"videoTitle": safe_text(exact_meta[-1].get("title")), "transcriptLanguage": language,
                   "transcriptIsTranslatedOrUnconfirmed": language not in {"ko", "korean"}, "segments": segments,
                   "rows": [{"key": item["key"], "recordName": safe_text(row.get("approved_name") or row.get("origin_name")),
                             "review": safe_text(row.get("tzuyang_review")), "priorIssues": item["issues"]} for item, row in group]}
        raw_content = json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode()
        jobs.append({"label": str(2000 + len(jobs)), "inputSha256": sha(raw_content), "content": content,
                     "sourceBinding": {"transcriptSha256": sha(raw), "metadataSha256": sha(metadata_raw),
                                       "recordHashes": {item["key"]: row["recordSha256"] for item, row in group}},
                     "completeTranscriptVersions": len(admitted)})
    return {"schemaVersion": 1, "sourceSnapshotSha256": SOURCE_HASH, "availabilityIndexSha256": INDEX_HASH,
            "candidateRows": len(index), "requests": jobs, "excluded": excluded, "languagesByRequest": dict(languages),
            "operatingWrites": 0, "videoVisualFactsCertified": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root", type=Path, required=True)
    parser.add_argument("--source-base", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.private_root, args.source_base)
    with args.output.open("x") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    args.output.chmod(0o600)
    print(json.dumps({"requests": len(result["requests"]), "rows": sum(len(r["content"]["rows"]) for r in result["requests"]),
                      "excluded": len(result["excluded"]), "languagesByRequest": result["languagesByRequest"],
                      "inputManifestSha256": sha(args.output.read_bytes()), "operatingWrites": 0}))


if __name__ == "__main__":
    main()
