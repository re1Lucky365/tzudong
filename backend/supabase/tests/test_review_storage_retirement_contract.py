"""Bind immutable reference guards, trigger event sets and caller-only policies.

Runtime permission/race/rollback evidence is separate in the exact PG17 packet.
"""
from pathlib import Path
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[3]
FENCE=ROOT/'backend/supabase/migrations/20261011105114_review_media_storage_retirement_fence.sql'
POLICY=ROOT/'backend/supabase/migrations/20261011110108_review_storage_caller_bound_admin_policy.sql'
READBACK=ROOT/'backend/supabase/scripts/local_catalog_readback.sql'


class ReviewStorageContract(unittest.TestCase):
    def test_existing_guard_body_and_review_branch_are_bound(self):
        sql=FENCE.read_text()
        old=re.search(r'\$old\$(.*?)\$old\$',sql,re.S).group(1)
        new=re.search(r'\$new\$(.*?)\$new\$',sql,re.S).group(1)
        parent=(ROOT/'backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql').read_text()
        original=re.search(r'CREATE FUNCTION review_media_private.guard_references\(\).*?AS \$\$(.*?)\$\$;',parent,re.S).group(1)
        self.assertEqual(old,original)
        for body in (old,new):self.assertIn(hashlib.sha256(body.encode()).hexdigest(),sql)
        self.assertEqual(new[new.index("  IF TG_OP = 'UPDATE'"):],old[old.index("  IF TG_OP = 'UPDATE'"):])
        self.assertIn("NEW.bucket_id IN ('review-photos','review-verifications')",new)
        self.assertIn('WHERE path=NEW.name AND retired',new)

    def test_serializer_precedes_row_locks_and_exact_event_sets_are_checked(self):
        sql=FENCE.read_text()
        for kind in ('STATEMENT','ROW'):
            self.assertIn(f'BEFORE INSERT OR UPDATE OF bucket_id,name ON storage.objects\n    FOR EACH {kind}',sql)
        self.assertIn("pg_get_triggerdef(oid)='CREATE TRIGGER a00_review_media_storage_serialize BEFORE INSERT OR UPDATE OF bucket_id, name",sql)
        self.assertIn("pg_get_triggerdef(oid)='CREATE TRIGGER a00_review_media_storage_guard BEFORE INSERT OR UPDATE OF bucket_id, name",sql)
        self.assertIn("381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250",sql)
        self.assertIn('REVOKE EXECUTE ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() FROM postgres;',sql)
        self.assertNotRegex(sql,r'(?i)(?:DISABLE\s+TRIGGER|session_replication_role|GRANT[^;]+TO (?:anon|authenticated|service_role))')

    def test_only_exact_legacy_policies_are_changed_without_oracle_grants(self):
        sql=POLICY.read_text()
        self.assertIn("NOT IN (0,2)",sql)
        self.assertIn('actual.polroles<>ARRAY[0::oid]',sql)
        self.assertIn("refobjid='public.is_user_admin(uuid)'::regprocedure)<>1",sql)
        self.assertIn("role_row.user_id=(SELECT auth.uid())",sql)
        self.assertIn("status_row.disabled_at IS NULL",sql)
        self.assertIn("TO authenticated %s (%s)",sql)
        self.assertIn('STORAGE_ADMIN_POLICY_PRESERVATION_DRIFT',sql)
        self.assertIn('049d579041975ddfaa0c560f56e4c57ee06099b2290f742636ba5bd9345463df',sql)
        executable=re.sub(r'--[^\n]*','',sql)
        self.assertNotRegex(executable,r'(?i)(?:GRANT\s|CREATE\s+(?:OR REPLACE\s+)?FUNCTION|ALTER\s+FUNCTION|DISABLE\s)')

    def test_catalog_readback_mirrors_both_complete_forward_checks(self):
        for path,marker in ((FENCE,'STORAGE_RETIREMENT_FENCE'),(POLICY,'STORAGE_CALLER_BOUND_ADMIN')):
            start=f'-- {marker}_READBACK_BEGIN\n';end=f'-- {marker}_READBACK_END'
            def block(source):return source.split(start,1)[1].split(end,1)[0]
            self.assertEqual(block(path.read_text()),block(READBACK.read_text()))


if __name__=='__main__':unittest.main()
