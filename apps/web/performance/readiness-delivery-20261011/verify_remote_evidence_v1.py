"""Verify sealed evidence bytes against a specific GitHub commit, without credentials in receipts."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

PACKAGES = {
    "apps/web/performance/tzuyang-review-census-20261009/checkpoint-complete-v7": "docs/evidence/census-complete-v7-artifact-map.sha256",
    "apps/web/performance/readiness-develop-integration-20261010": "docs/evidence/readiness-develop-integration-20261010-artifact-map.sha256",
    "apps/web/performance/readiness-followthrough-20261010": "docs/evidence/readiness-followthrough-20261010-artifact-map.sha256",
}


def verify(root, revision, repo, receipt):
    cache = {}

    def api(endpoint):
        result = subprocess.run(["gh", "api", endpoint], capture_output=True, timeout=60)
        if result.returncode:
            raise ValueError("REMOTE_API_FAILED")
        return json.loads(result.stdout)

    def tree(oid):
        if oid not in cache:
            cache[oid] = api(f"repos/{repo}/git/trees/{oid}")
        value = cache[oid]
        if value.get("truncated"):
            raise ValueError("REMOTE_TREE_TRUNCATED")
        return value["tree"]

    commit = api(f"repos/{repo}/git/commits/{revision}")
    if commit["sha"] != revision:
        raise ValueError("REMOTE_REVISION_DRIFT")
    receipt["remoteCommitVerified"] = True
    for package, pin_path in PACKAGES.items():
        base = root / package
        raw = (base / "artifact-map.json").read_bytes()
        map_hash = hashlib.sha256(raw).hexdigest()
        if map_hash != (root / pin_path).read_text().split()[0]:
            raise ValueError("DETACHED_MAP_DRIFT")
        entries = json.loads(raw)["files"]
        expected = {item["path"]: item for item in entries}
        actual = {str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()}
        if len(entries) != len(expected) or actual != set(expected) | {"artifact-map.json"}:
            raise ValueError("LOCAL_TREE_DRIFT")
        expected["artifact-map.json"] = {"bytes": len(raw), "sha256": map_hash}
        oid = commit["tree"]["sha"]
        for component in Path(package).parts:
            children = [item for item in tree(oid) if item["path"] == component and item["type"] == "tree"]
            if len(children) != 1:
                raise ValueError("REMOTE_PACKAGE_MISSING")
            oid = children[0]["sha"]
        subtree = api(f"repos/{repo}/git/trees/{oid}?recursive=1")
        if subtree.get("truncated"):
            raise ValueError("REMOTE_PACKAGE_TRUNCATED")
        blobs = {item["path"]: item for item in subtree["tree"] if item["type"] == "blob"}
        if set(blobs) != set(expected):
            raise ValueError("REMOTE_PACKAGE_TREE_DRIFT")
        package_result = {"path": package, "mapSha256": map_hash, "files": len(expected), "verified": 0}
        receipt["packages"].append(package_result)
        for name, item in expected.items():
            path = base / name
            if path.is_symlink() or Path(name).is_absolute() or ".." in Path(name).parts:
                raise ValueError("ARTIFACT_PATH_DENIED")
            data = path.read_bytes()
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("LOCAL_ARTIFACT_DRIFT")
            git_oid = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if git_oid != blobs[name]["sha"] or blobs[name]["size"] != len(data):
                receipt["mismatchPath"] = package + "/" + name
                raise ValueError("REMOTE_BLOB_BYTES_DRIFT")
            package_result["verified"] += 1
        remote_map = api(f"repos/{repo}/git/blobs/{blobs['artifact-map.json']['sha']}")
        if remote_map.get("encoding") != "base64" or base64.b64decode(remote_map["content"]) != raw:
            raise ValueError("REMOTE_MAP_DOWNLOAD_DRIFT")
        package_result["mapDownloadBytesEqual"] = True
    receipt["apiTreeCalls"] = len(cache)
    receipt["verifiedFiles"] = sum(item["verified"] for item in receipt["packages"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--revision", required=True)
    parser.add_argument("--repo", default="twoimo/tzudong")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("INVALID_TARGET")
    receipt = {"schemaVersion": 1, "observedAtUtc": datetime.now(timezone.utc).isoformat(),
               "revision": args.revision, "repo": args.repo, "packages": [], "status": "failed",
               "performanceAdmission": 0, "hostedWrites": 0, "fieldAdmission": 0}
    try:
        verify(args.root.resolve(), args.revision, args.repo, receipt)
        receipt["status"] = "passed"
    except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        receipt["failureCode"] = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]+", str(error)) else "VERIFICATION_FAILED"
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"status": receipt["status"], "verifiedFiles": receipt.get("verifiedFiles", 0), "failureCode": receipt.get("failureCode")}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
