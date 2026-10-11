"""Source and privilege binding for the terminal, serialized GET-only recovery."""
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
FORWARD = ROOT / 'backend/supabase/migrations/20261011100730_admin_record_expired_preview_readback.sql'


class ExpiredPreviewReadbackContract(unittest.TestCase):
    def test_unique_replacement_only_adds_the_server_preview_expiry_guard(self):
        source = FORWARD.read_text()
        old = re.search(r'\$old\$(.*?)\$old\$', source, re.S).group(1)
        new = re.search(r'\$new\$(.*?)\$new\$', source, re.S).group(1)
        added = "  IF op.state='preview' AND op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'RECORD_ACTION_PREVIEW_EXPIRED'; END IF;\n"
        self.assertEqual(new, old.replace('  RETURN op.receipt||', added + '  RETURN op.receipt||'))
        original = (ROOT / 'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql').read_text()
        self.assertEqual(original.count(old), 1)
        readback = original.index("IF p_phase='readback' THEN")
        for lock in ('admin_record_assert_operator(p_actor)', 'pg_advisory_xact_lock', 'FOR UPDATE', 'op.actor<>p_actor'):
            self.assertLess(original.index(lock, original.index('CREATE FUNCTION public.admin_record_action')), readback)
        self.assertIn('2353de06b4d93f45fd603380e678f4edbcc0b16a8bd9860b5967683bea5f1157', source)
        self.assertIn('50b5900a7b6ca43062d6373dbba75378d714312c9ef02c6939997389f6833ba0', source)

    def test_forward_preserves_owner_defaults_acl_manifest_and_membership(self):
        source = FORWARD.read_text()
        for guard in ('IS DISTINCT FROM metadata', 'IS DISTINCT FROM defaults', 'IS DISTINCT FROM before_members',
                      'IS DISTINCT FROM before_manifest', 'IS DISTINCT FROM before_schema'):
            self.assertIn(guard, source)
        self.assertNotRegex(source, r'(?i)(?:\bGRANT\b|\bALTER ROLE\b|\bDISABLE TRIGGER\b)')
        self.assertIn("NOT prosecdef", source)
        for role in ('anon', 'authenticated', 'service_role'):
            self.assertIn(f"has_function_privilege('{role}'", source)

    def test_canonical_readback_reuses_exact_postcondition(self):
        def block(text):
            return text.split('-- ADMIN_PREVIEW_EXPIRY_READBACK_BEGIN\n', 1)[1].split('-- ADMIN_PREVIEW_EXPIRY_READBACK_END', 1)[0]
        self.assertEqual(block(FORWARD.read_text()), block((ROOT / 'backend/supabase/scripts/local_catalog_readback.sql').read_text()))


if __name__ == '__main__':
    unittest.main()
