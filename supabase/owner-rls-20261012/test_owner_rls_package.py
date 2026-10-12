"""Offline package checks. No database, credentials or private records are loaded."""

import hashlib
import json
from pathlib import Path
import re
import unittest


PACKAGE = Path(__file__).resolve().parent
TABLES = {
    'chat_sessions', 'chat_messages', 'messages',
    'session_files', 'workflow_steps', 'shared_files',
}
DEPLOYED_SHA = '0c4500a8e5c0fe2beb7ffa3365ee9c063806fa0ad82538641effd7647db7aee3'
ROLLBACK_SHA = '3f3b5dc41fdbe99fd220312aeba10060ab4932bd17b6f6bfc335e08ff26b7b30'


class OwnerRlsPackageTests(unittest.TestCase):
    def test_positive_allowlist_and_hashes(self):
        manifest = json.loads((PACKAGE / 'source-manifest.json').read_text())
        allowed = {item['path'] for item in manifest['files']}
        actual = {p.name for p in PACKAGE.iterdir() if p.is_file()}
        self.assertEqual(actual, allowed | {'source-manifest.json'})
        for item in manifest['files']:
            self.assertEqual(Path(item['path']).name, item['path'])
            raw = (PACKAGE / item['path']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item['sha256'])
            self.assertEqual(len(raw), item['bytes'])

    def test_exact_deployed_and_rollback_bytes(self):
        self.assertEqual(hashlib.sha256((PACKAGE / 'deployed-owner-rls.sql').read_bytes()).hexdigest(), DEPLOYED_SHA)
        self.assertEqual(hashlib.sha256((PACKAGE / 'rollback-owner-rls.sql').read_bytes()).hexdigest(), ROLLBACK_SHA)

    def test_only_six_policy_targets_and_twelve_added_policies(self):
        sql = (PACKAGE / 'deployed-owner-rls.sql').read_text()
        policies = re.findall(r'CREATE POLICY (\w+) ON public\.(\w+) AS (\w+) FOR ALL TO (\w+)', sql)
        self.assertEqual(len(policies), 12)
        self.assertEqual({table for _, table, _, _ in policies}, TABLES)
        for table in TABLES:
            self.assertEqual({(name, mode, role) for name, target, mode, role in policies if target == table}, {
                ('pa_owner_restrictive_20261012', 'RESTRICTIVE', 'PUBLIC'),
                ('pa_owner_permissive_20261012', 'PERMISSIVE', 'authenticated'),
            })
        self.assertNotRegex(sql, r'(?im)^\s*(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER ROLE)\b')

    def test_rollback_drops_only_added_policies(self):
        sql = (PACKAGE / 'rollback-owner-rls.sql').read_text()
        drops = re.findall(r'DROP POLICY IF EXISTS (\w+) ON public\.(\w+)', sql)
        self.assertEqual(len(drops), 12)
        self.assertEqual({table for _, table in drops}, TABLES)
        self.assertEqual({name for name, _ in drops}, {'pa_owner_restrictive_20261012', 'pa_owner_permissive_20261012'})
        self.assertNotRegex(sql, r'(?im)^\s*(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER TABLE|ALTER ROLE)\b')

    def test_consolidated_readonly_verifier_contract(self):
        for name in ['verify-anon-readonly.sql', 'verify-owner-outside-owner-readonly.sql', 'verify-service-counts-readonly.sql']:
            sql = (PACKAGE / name).read_text()
            self.assertIn('BEGIN READ ONLY;', sql)
            self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
            self.assertEqual(len(re.findall(r'AS verification\b', sql)), 1)
            self.assertNotRegex(sql, r'(?im)^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b')
            for table in TABLES:
                self.assertIn("'" + table + "'", sql)
            self.assertIn("'current_user',current_user", sql)

    def test_no_credentials_or_private_data_artifacts_in_package(self):
        for path in PACKAGE.iterdir():
            if not path.is_file():
                continue
            text = path.read_text()
            self.assertNotRegex(text, r'sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----')
            self.assertNotRegex(text, r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
            self.assertNotRegex(text, r'/(?:Users|home)/[^\s]+')
        audit = json.loads((PACKAGE / 'audit.json').read_text())
        self.assertEqual(audit['migration_sha256'], DEPLOYED_SHA)
        self.assertFalse(audit['claims']['complete_database_security_certification'])
        self.assertFalse(audit['claims']['row_write_isolation_tested'])
        self.assertFalse(audit['private_data_in_public_audit'])


if __name__ == '__main__':
    unittest.main()
