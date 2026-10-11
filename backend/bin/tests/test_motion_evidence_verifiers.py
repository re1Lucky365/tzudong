"""Relocated-checkout and optimized-Python adversarial evidence verification."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ('verify_readiness_followup_20261011.py',
           'verify_transitions_adoption_20261012.py', 'verify_scroll_transitions_20261012.py')
PACKAGES = ('readiness-media-followup-20261011', 'tzuyang-review-minimal-20261011',
            'readiness-gemini-integration-20261011', 'readiness-delivery-integration-20261012',
            'transitions-adoption-20261012', 'scroll-transitions-20261012')


class EvidenceVerifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('node'):
            raise unittest.SkipTest('Node 24 required for the independent canonical validator')
        if not subprocess.check_output(['node', '--version'], text=True).startswith('v24.'):
            raise unittest.SkipTest('Node 24 required for the independent canonical validator')
        cls.tmp = tempfile.TemporaryDirectory(prefix='motion verifier ')
        cls.repo = Path(cls.tmp.name).resolve() / 'relocated checkout'
        subprocess.run(['git', 'clone', '--quiet', '--shared', '--no-checkout', str(ROOT), str(cls.repo)], check=True)
        paths = [f'apps/web/performance/{name}/' for name in PACKAGES]
        paths += [f'docs/evidence/{name}-map-v1.sha256' for name in PACKAGES]
        dependencies = set()
        for name in ('transitions-adoption-20261012', 'scroll-transitions-20261012'):
            source = json.loads((ROOT / f'apps/web/performance/{name}/source-manifest-v1.json').read_bytes())
            dependencies.update(source.get('dependencyFiles', {}))
            dependencies.update(source.get('fixtureDependencyFiles', {}))
        paths += sorted(dependencies)
        paths += ['apps/web/scripts/validate-performance-backlog.mjs']
        subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', '--stdin'], cwd=cls.repo,
                       input='\n'.join(paths) + '\n', text=True, capture_output=True, check=True)
        subprocess.run(['git', 'checkout', '--quiet', '--detach', 'HEAD'], cwd=cls.repo, check=True)
        for name in SCRIPTS:
            dest = cls.repo / 'backend/bin' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'backend/bin' / name, dest)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_verifier(self, name, optimized=False):
        env = dict(os.environ)
        env.pop('PYTHONOPTIMIZE', None)
        return subprocess.run([sys.executable, *(['-O'] if optimized else []), str(self.repo / 'backend/bin' / name)],
                              cwd=self.repo, env=env, capture_output=True, text=True, timeout=45)

    def test_relocated_checkout_validates_both_python_modes(self):
        for script in SCRIPTS:
            for optimized in (False, True):
                with self.subTest(script=script, optimized=optimized):
                    p = self.run_verifier(script, optimized)
                    self.assertEqual(p.returncode, 0, p.stderr[-1500:])
                    self.assertIn('"performanceAdmission": 0', p.stdout)

    def test_corrupted_map_is_rejected_even_under_optimization(self):
        for script, package in zip(SCRIPTS, (PACKAGES[0], PACKAGES[4], PACKAGES[5])):
            path = self.repo / f'apps/web/performance/{package}/artifact-map-v1.json'
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n')
                for optimized in (False, True):
                    with self.subTest(script=script, optimized=optimized):
                        p = self.run_verifier(script, optimized)
                        self.assertNotEqual(p.returncode, 0)
            finally:
                path.write_bytes(original)

    def test_validator_executes_checkout_local_script(self):
        path = self.repo / 'apps/web/scripts/validate-performance-backlog.mjs'
        original = path.read_bytes()
        try:
            path.write_text("throw Error('RELOCATED_VALIDATOR_PROBE');\n")
            p = self.run_verifier(SCRIPTS[1], True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('RELOCATED_VALIDATOR_PROBE', p.stderr)
        finally:
            path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
