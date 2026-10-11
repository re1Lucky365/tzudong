"""Bind the forward replay to the immutable trigger and its privilege boundary."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
FORWARD = MIGRATIONS / "20261011094346_admin_evaluation_revision_safeupdate.sql"


class RevisionSafeupdateContract(unittest.TestCase):
    def test_replacement_accepts_only_the_historical_body_and_changes_one_statement(self):
        historical = (MIGRATIONS / "20261002235102_admin_evaluation_pagination.sql").read_text()
        body = re.search(r"CREATE FUNCTION pipeline_control.bump_admin_evaluation_revision\(\).*?AS \$\$(.*?)\$\$;",
                         historical, re.S).group(1)
        source = FORWARD.read_text()
        old = re.search(r"\$old\$(.*?)\$old\$", source, re.S).group(1)
        new = re.search(r"\$new\$(.*?)\$new\$", source, re.S).group(1)
        self.assertEqual(body.count(old), 1)
        self.assertEqual(new, old[:-1] + " WHERE singleton;")
        self.assertIn(hashlib.sha256(body.encode()).hexdigest(), source)
        self.assertIn(hashlib.sha256(body.replace(old, new).encode()).hexdigest(), source)

    def test_forward_does_not_disable_safeupdate_or_widen_authority(self):
        source = FORWARD.read_text()
        self.assertIn("to_jsonb(p)-'prosrc'", source)
        for protected in ("IS DISTINCT FROM metadata", "IS DISTINCT FROM before_members",
                          "IS DISTINCT FROM before_manifest", "IS DISTINCT FROM before_schema"):
            self.assertIn(protected, source)
        self.assertNotRegex(source, r"(?i)(?:\bGRANT\b|\bALTER ROLE\b|\bDISABLE TRIGGER\b|\bSET[^;]*safeupdate)")
        self.assertIn("proacl=ARRAY['postgres=X/postgres']::aclitem[]", source)

    def test_canonical_readback_uses_the_same_postcondition(self):
        def block(source):
            return source.split("-- ADMIN_REVISION_READBACK_BEGIN\n", 1)[1].split("-- ADMIN_REVISION_READBACK_END", 1)[0]
        self.assertEqual(block(FORWARD.read_text()),
                         block((ROOT / "backend/supabase/scripts/local_catalog_readback.sql").read_text()))


if __name__ == "__main__":
    unittest.main()
