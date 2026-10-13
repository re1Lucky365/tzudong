#!/usr/bin/env python3
"""Build a review-only identity carrier for the pending hosted DB transition.

The carrier deliberately contains no connection string, SQL body, database
mutation, writer-fence receipt, or authorization.  Every source identity is
read from the pinned protected-main commit through Git.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
MAIN_COMMIT = "056a86600f412eb42df4304e3206841679012f3e"
MAIN_TREE = "4b47fe832c375a9a0f829332c354379c042ace06"
PROJECT_REF = "aqlcofblfxdrjhhdmarw"
PARSER_PATH = "backend/supabase/scripts/g037_supabase_statement_vector.mjs"

MIGRATIONS = [
    "backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql",
    "backend/supabase/migrations/20261008200719_review_verification_private.sql",
    "backend/supabase/migrations/20261008201635_review_media_catalog_integration.sql",
    "backend/supabase/migrations/20261011072824_admin_review_media_completion.sql",
    "backend/supabase/migrations/20261011085342_review_legacy_shared_cleanup.sql",
    "backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql",
    "backend/supabase/migrations/20261011100730_admin_record_expired_preview_readback.sql",
    "backend/supabase/migrations/20261011103501_admin_verification_durable_staging.sql",
    "backend/supabase/migrations/20261011105114_review_media_storage_retirement_fence.sql",
    "backend/supabase/migrations/20261011110108_review_storage_caller_bound_admin_policy.sql",
    "backend/supabase/migrations/20261011175912_review_owner_cleanup_completion.sql",
]

EXECUTOR_PATHS = [
    ".github/admin-record-sql-successor.v1.json",
    ".github/supabase-migration-release-manifest.v1.json",
    "apps/web/scripts/admin-record-sql-successor.mjs",
    "apps/web/scripts/apply-supabase-migration.mjs",
    "apps/web/scripts/supabase-migration-bundle.mjs",
]


def git(*args: str, binary: bool = False) -> str | bytes:
    result = subprocess.check_output(["git", *args], cwd=ROOT)
    return result if binary else result.decode().strip()


def show(path: str) -> bytes:
    return git("show", f"{MAIN_COMMIT}:{path}", binary=True)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def json_vector_sha(statements: list[str]) -> str:
    encoded = json.dumps(
        statements,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    return sha256(encoded)


def leading_sql(statement: str) -> str:
    value = statement.lstrip()
    while True:
        if value.startswith("--"):
            end = value.find("\n")
            value = "" if end < 0 else value[end + 1 :].lstrip()
            continue
        if value.startswith("/*"):
            end = value.find("*/", 2)
            if end < 0:
                raise RuntimeError("unterminated leading comment")
            value = value[end + 2 :].lstrip()
            continue
        return value


def source_metadata(parser: Path, path: str, temp_root: Path) -> dict[str, object]:
    raw = show(path)
    filename = Path(path).name
    match = re.fullmatch(r"(\d{14})_([a-z0-9_]+)\.sql", filename)
    if not match:
        raise RuntimeError(f"invalid migration path: {path}")
    version, name = match.groups()
    source = temp_root / filename
    source.write_bytes(raw)
    digest = sha256(raw)
    parsed = subprocess.check_output(
        [
            "node",
            str(parser),
            "--source",
            str(source),
            "--version",
            version,
            "--sha256",
            digest,
            "--size",
            str(len(raw)),
        ],
        cwd=ROOT,
        text=True,
    )
    vector = json.loads(parsed)
    statements = vector["statements"]
    controls = []
    for index, statement in enumerate(statements):
        token = leading_sql(statement)
        control = re.match(
            r"(?i)^(BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION)\b",
            token,
        )
        if control:
            controls.append(
                {
                    "index": index,
                    "control": re.sub(r"\s+", " ", control.group(1).upper()),
                }
            )
    return {
        "id": name,
        "version": version,
        "name": name,
        "path": path,
        "bytes": len(raw),
        "sha256": digest,
        "gitBlob": git("rev-parse", f"{MAIN_COMMIT}:{path}"),
        "statementCount": len(statements),
        "statementVectorSha256": json_vector_sha(statements),
        "transactionControls": controls,
    }


def exact_main() -> None:
    if git("rev-parse", "origin/main") != MAIN_COMMIT:
        raise RuntimeError("origin/main moved; review the new protected main before rebuilding")
    if git("rev-parse", f"{MAIN_COMMIT}^{{tree}}") != MAIN_TREE:
        raise RuntimeError("protected-main tree mismatch")


def main() -> None:
    exact_main()
    parser_bytes = show(PARSER_PATH)
    with tempfile.TemporaryDirectory(prefix="tzudong-db-carrier-") as temporary:
        temp_root = Path(temporary)
        parser = temp_root / Path(PARSER_PATH).name
        parser.write_bytes(parser_bytes)
        migrations = [source_metadata(parser, path, temp_root) for path in MIGRATIONS]

    if [item["version"] for item in migrations] != sorted(item["version"] for item in migrations):
        raise RuntimeError("migration order is not chronological")

    successor = json.loads(show(".github/admin-record-sql-successor.v1.json"))
    release = json.loads(show(".github/supabase-migration-release-manifest.v1.json"))
    target_paths = set(MIGRATIONS)
    successor_coverage = sorted(
        item["path"] for item in successor["migrations"] if item["path"] in target_paths
    )
    release_coverage = sorted(
        item["path"] for item in release["migrations"] if item["path"] in target_paths
    )

    carrier = {
        "schemaVersion": 1,
        "id": "goal_delivery_20261012_pending_db_transition",
        "mode": "review_only_non_executable",
        "projectRef": PROJECT_REF,
        "protectedSource": {
            "commit": MAIN_COMMIT,
            "tree": MAIN_TREE,
            "ref": "refs/remotes/origin/main",
        },
        "priorHostedObservation": {
            "source": "same-goal read-only audit; not refreshed by this carrier",
            "ledgerRows": 86,
            "latestVersion": "20261009101645",
            "targetAppliedCount": 0,
            "freshExecutionWindowReadbackRequired": True,
        },
        "transition": {
            "targetCount": len(migrations),
            "expectedLedgerRowsIfNoConcurrentChanges": 97,
            "expectedLatestVersion": migrations[-1]["version"],
            "requireAllExactStatementVectors": True,
            "migrationOrder": [item["version"] for item in migrations],
        },
        "criticalPreconditions": {
            "databaseRole": {
                "currentUser": "postgres",
                "sessionUser": "postgres",
                "transactionReadOnly": "off",
                "serverMajor": [15, 17],
            },
            "ownerCleanup": {
                "function": "public.finish_review_media_cleanup()",
                "requiredPreimageSha256": "f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1",
                "requiredPostimageSha256": "a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9",
                "privacyWorkflowOwner": "restricted, non-login, non-inherit, non-bypassrls",
                "pg17Authority": "external admin-option grant to postgres must exist; self-grant is forbidden",
            },
            "freshReadbackRequired": True,
        },
        "migrations": migrations,
        "expectedTerminalContracts": {
            "relations": [
                "review_media_private.commits",
                "review_media_private.cleanup",
            ],
            "functions": [
                "public.mutate_review_with_media(uuid,uuid,text,timestamptz,text,text[],text[])",
                "public.queue_review_upload_cleanup(uuid,text[])",
                "public.read_review_media_commit(uuid,uuid,text)",
                "public.pending_review_media_cleanup()",
                "public.finish_review_media_cleanup()",
                "public.review_media_delete_allowed(text)",
                "public.review_media_upload_allowed(text,text)",
                "public.admin_review_verification_cleanup(uuid,text,text[])",
            ],
            "policies": [
                "review_media_safe_delete",
                "review_media_safe_insert",
                "review_media_safe_update",
                "review_verifications_owner_read",
                "review_verifications_owner_insert",
                "review_verifications_owner_delete",
                "review_verifications_safe_delete",
                "review_photos_food_insert",
                "review_photos_food_update",
            ],
            "functionBodySha256": {
                "public.mutate_review_with_media(uuid,uuid,text,timestamptz,text,text[],text[])": "d5d6646a4294c0e7bd0cd75ea47a996c9c57bac6c32a39ac53fbb7a8b1e7e323",
                "review_media_private.enqueue_removed()": "cbf6a87e453e8c2e14d67acd73a92e399fbba4b4f24ac27966806e13ef1fd905",
                "review_media_private.guard_references()": "94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1",
                "public.admin_review_verification_cleanup(uuid,text,text[])": "468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b",
                "public.finish_review_media_cleanup()": "a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9",
            },
            "acl": {
                "reviewMediaOwnerFunctions": "authenticated only as asserted by migration readbacks",
                "adminReviewVerificationCleanup": "service_role only",
                "publicIsUserAdmin": "no EXECUTE for anon, authenticated, or service_role",
                "privacyWorkflowOwner": "restricted non-login owner; fresh G014 terminal readback required",
            },
            "storage": {
                "buckets": ["review-photos", "review-verifications"],
                "callerBoundAdminPolicies": True,
                "retirementFence": True,
                "noObjectMutationByThisCarrier": True,
            },
        },
        "applicationDependency": {
            "mustPrecedeAppDeployment": True,
            "source": "apps/web/lib/reviews/review-media-mutation.ts",
            "requiredRpcs": [
                "mutate_review_with_media",
                "queue_review_upload_cleanup",
                "read_review_media_commit",
            ],
        },
        "existingExecutorCompatibility": {
            "adminRecordSqlSuccessor": {
                "targetCoverage": successor_coverage,
                "targetCoverageCount": len(successor_coverage),
                "fixedMigrationCount": len(successor["migrations"]),
                "operatingTransition": successor["operatingTransition"],
                "compatible": False,
                "reason": "fixed five-stage 80-to-85 manifest does not admit these 11 paths",
            },
            "genericReleaseManifest": {
                "targetCoverage": release_coverage,
                "targetCoverageCount": len(release_coverage),
                "compatible": False,
                "reason": "fixed canonical release manifest has no target entries or target readbacks",
            },
            "bundleCompiler": {
                "supportedBundleSizes": [4, 5],
                "wholeTransitionSupported": False,
                "reason": "no admitted 11-stage executor or cross-chunk terminal state contract",
            },
        },
        "executorSources": [
            {
                "path": path,
                "sha256": sha256(show(path)),
                "gitBlob": git("rev-parse", f"{MAIN_COMMIT}:{path}"),
            }
            for path in EXECUTOR_PATHS
        ],
        "requiredExecutionHolds": {
            "writerFences": {
                "adminRecordMutationsHold": "active",
                "g037WriteFreeze": "active",
                "automaticReviewer": "stopped",
                "browserRpc": "stopped",
                "directSql": "stopped",
                "dashboard": "stopped",
                "providerIngress": "stopped",
            },
            "freshProtectedReleaseReceipt": True,
            "freshAdmissionReceipt": True,
            "freshPriorStateAndTerminalReadbacks": True,
            "namedRollbackSourceSha": True,
            "currentTaskAuthorizesExecution": False,
        },
        "exclusions": [
            "database writes",
            "storage writes",
            "queue claims",
            "worker changes",
            "provider calls",
            "deployment",
            "billing",
        ],
    }

    output = OUT / "review-carrier-v1.json"
    output.write_text(json.dumps(carrier, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "built", "migrations": len(migrations), "path": str(output)}))


if __name__ == "__main__":
    main()
