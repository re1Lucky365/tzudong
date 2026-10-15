"""Bind service-only staging and the shared-reference completion predicate."""
from pathlib import Path
import hashlib
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
SQL = ROOT / 'backend/supabase/migrations/20261011103501_admin_verification_durable_staging.sql'


class AdminStagingContract(unittest.TestCase):
    def test_hash_binding_preserves_original_sql_and_adds_bounded_owner_staging(self):
        text = SQL.read_text()
        old = re.search(r'\$old\$(.*?)\$old\$', text, re.S).group(1)
        new = re.search(r'\$new\$(.*?)\$new\$', text, re.S).group(1)
        previous = (ROOT / 'backend/supabase/migrations/20261011072824_admin_review_media_completion.sql').read_text()
        original = re.search(r'AS \$cleanup\$(.*?)\$cleanup\$;', previous, re.S).group(1)
        self.assertEqual(old, original)
        for body in (old, new):
            self.assertIn(hashlib.sha256(body.encode()).hexdigest(), text)
        self.assertIn('cardinality(p_paths)<>1', new)
        self.assertIn("review_media_private.canonical(p_paths[1],owner,p_review_id,'verification')", new)
        self.assertIn('AND NOT retired AND NOT complete', new)
        self.assertLess(new.index('pg_advisory_xact_lock'), new.index("IF p_phase = 'stage'"))
        self.assertIn("AND c.retired AND NOT c.complete\n      AND NOT review_media_private.referenced(c.path)", new)

    def test_privileges_schema_and_membership_lease_are_restored(self):
        text = SQL.read_text()
        for guard in ('IS DISTINCT FROM metadata', 'IS DISTINCT FROM defaults', 'IS DISTINCT FROM before_manifest',
                      'IS DISTINCT FROM before_schema', 'IS DISTINCT FROM before_members', 'IS DISTINCT FROM before_assertions'):
            self.assertIn(guard, text)
        self.assertIn('schema_lease THEN REVOKE CREATE ON SCHEMA public', text)
        self.assertIn('PERFORM pg_temp.review_shared_assert()', text)
        self.assertIn("has_function_privilege('anon'", text)
        self.assertIn("has_function_privilege('authenticated'", text)
        self.assertIn("NOT has_function_privilege('service_role'", text)

    def test_readback_mirror_is_exact(self):
        def block(text):
            return text.split('-- ADMIN_STAGING_READBACK_BEGIN\n', 1)[1].split('-- ADMIN_STAGING_READBACK_END', 1)[0]
        self.assertEqual(block(SQL.read_text()), block((ROOT / 'backend/supabase/scripts/local_catalog_readback.sql').read_text()))


if __name__ == '__main__':
    unittest.main()
