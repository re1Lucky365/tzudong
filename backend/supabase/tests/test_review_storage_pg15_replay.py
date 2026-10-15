"""The compatibility wrapper must preserve source/function/API guard bytes."""
from pathlib import Path
import re
import unittest
from backend.supabase.scripts.transform_review_storage_pg15_replay import transform,NAME,PREFIX,SUFFIX,ANCHOR,REPLACEMENT

ROOT=Path(__file__).resolve().parents[3]


class ReviewStoragePg15ReplayTests(unittest.TestCase):
    def test_only_inspected_acl_predicate_changes(self):
        source=(ROOT/'backend/supabase/migrations'/NAME).read_bytes()
        expected=b''.join(line for line in source.replace(ANCHOR,REPLACEMENT).splitlines(keepends=True) if line.rstrip(b'\r\n') not in (b'BEGIN;',b'COMMIT;'))
        actual=transform(source)
        self.assertEqual(actual,PREFIX+expected+SUFFIX)
        for marker in (b'$old$',b'$new$'):
            self.assertEqual(actual.split(marker)[1],source.split(marker)[1])
        self.assertEqual(actual.count(b'GRANT EXECUTE ON FUNCTION'),source.count(b'GRANT EXECUTE ON FUNCTION'))
        self.assertEqual(actual.count(b'REVOKE EXECUTE ON FUNCTION'),source.count(b'REVOKE EXECUTE ON FUNCTION'))
        self.assertIn(b"a.grantee='postgres'::regrole",REPLACEMENT)
        self.assertIn(b'IS DISTINCT FROM before_members',actual)

    def test_wrong_source_or_filename_is_rejected_before_output(self):
        source=(ROOT/'backend/supabase/migrations'/NAME).read_bytes()
        for value,name in ((source+b'\n',NAME),(source,NAME.replace('11105114','11103501')),(source.replace(b'lock_timeout',b'lock_timeout_changed'),NAME)):
            with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):transform(value,name)

    def test_actor_version_baseline_and_final_denials_remain(self):
        self.assertIn(b"current_user<>'postgres' OR session_user<>'postgres'",PREFIX)
        self.assertIn(b"server_version_num')::integer/10000<>15",PREFIX)
        self.assertIn(b"transaction_read_only')<>'off'",PREFIX)
        for source in (PREFIX,SUFFIX):
            self.assertIn(b'pg_temp.review_storage_pg15_boundary',source)
            self.assertIn(b"has_function_privilege('postgres'",source)
        self.assertIn(b'IS DISTINCT FROM',SUFFIX)
        actual=transform((ROOT/'backend/supabase/migrations'/NAME).read_bytes())
        self.assertIn(b"has_function_privilege('anon'",actual)
        self.assertIn(b"has_function_privilege('authenticated'",actual)
        self.assertIn(b"has_function_privilege('service_role'",actual)
        self.assertIn(b'pg_get_triggerdef(oid)',actual)

    def test_driver_has_one_hash_bound_branch_and_records_transformed_bytes(self):
        driver=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        branches=re.findall(r'^\s+([^\n]+\.sql)\)\s*$',driver,re.M)
        self.assertEqual(sum(NAME in value.split('|') for value in branches),1)
        branch=driver.split(NAME+')',1)[1].split(';;',1)[0]
        self.assertIn('transform_review_storage_pg15_replay.py',branch)
        self.assertIn("g026_chain_apply 'review-storage-pg15-replay-transformer'",branch)
        self.assertIn('g026_chain_apply "review-storage-pg15-replay:',branch)
        self.assertIn('ON_ERROR_STOP=1',branch)


if __name__=='__main__':unittest.main()
