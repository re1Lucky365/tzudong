"""Hash-bound PG15 source replay: distinguish owner inheritance from direct EXEC.

The original source and its function bodies remain immutable. The wrapper is
not a hosted apply path and accepts only the one inspected source unit.
"""
from pathlib import Path
import argparse
import hashlib

NAME='20261011105114_review_media_storage_retirement_fence.sql'
SHA256='79375138d7e82a3be2b85b219ff52147db13db9c93070569be40a61ab97c3d53'
BYTES=11418
ANCHOR=b"""  IF has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('postgres','review_media_private.lock_changes()','EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_FENCE_LEASE_BASELINE_DRIFT'; END IF;
"""
REPLACEMENT=b"""  -- PG15 inherits the temporary owner role here. Admit no direct executor ACL.
  IF EXISTS(SELECT 1 FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) AS a
    WHERE p.oid IN ('review_media_private.guard_references()'::regprocedure,
      'review_media_private.lock_changes()'::regprocedure)
      AND a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_FENCE_LEASE_BASELINE_DRIFT'; END IF;
"""
PREFIX=b"""BEGIN;
CREATE TEMP TABLE review_storage_pg15_boundary (members text) ON COMMIT DROP;
DO $pg15_boundary$ BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('server_version_num')::integer/10000<>15
    OR current_setting('transaction_read_only')<>'off'
    OR has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('postgres','review_media_private.lock_changes()','EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_PG15_REPLAY_BASELINE_DENIED'; END IF;
  INSERT INTO pg_temp.review_storage_pg15_boundary SELECT encode(sha256(convert_to(
    (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m),'UTF8')),'hex');
END $pg15_boundary$;
"""
SUFFIX=b"""
DO $pg15_boundary$ BEGIN
  IF (SELECT members FROM pg_temp.review_storage_pg15_boundary) IS DISTINCT FROM
    encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m),'UTF8')),'hex')
    OR has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('postgres','review_media_private.lock_changes()','EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_PG15_REPLAY_RESTORE_DRIFT'; END IF;
END $pg15_boundary$;
COMMIT;
"""


def transform(source,name=NAME):
    if name!=NAME or len(source)!=BYTES or hashlib.sha256(source).hexdigest()!=SHA256:
        raise ValueError('STORAGE_PG15_REPLAY_SOURCE_DRIFT')
    if source.count(ANCHOR)!=1:raise ValueError('STORAGE_PG15_REPLAY_ANCHOR_DRIFT')
    lines=source.replace(ANCHOR,REPLACEMENT).splitlines(keepends=True)
    if sum(line.rstrip(b'\r\n')==b'BEGIN;' for line in lines)!=1 or sum(line.rstrip(b'\r\n')==b'COMMIT;' for line in lines)!=1:
        raise ValueError('STORAGE_PG15_REPLAY_ENVELOPE_DRIFT')
    return PREFIX+b''.join(line for line in lines if line.rstrip(b'\r\n') not in (b'BEGIN;',b'COMMIT;'))+SUFFIX


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=transform(a.source.read_bytes(),a.source.name)
    with a.output.open('xb') as destination:destination.write(result)


if __name__=='__main__':main()
