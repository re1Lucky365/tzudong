"""Exercise the actual shell admission loop with finished child jobs."""
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / '08-chunk-multimodal-crawling.sh'


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'POSIX Bash required')
class ChunkSlotReleaseTests(unittest.TestCase):
    def test_finished_success_and_failure_both_release_the_slot(self):
        source = SCRIPT.read_text()
        loop = re.search(r'        while \[ \$\(jobs .*?\n        done', source, re.S)
        self.assertIsNotNone(loop)
        for child_code in (0, 1):
            with self.subTest(child_code=child_code):
                command = f'set +m\nmax_jobs=1\n(exit {child_code}) &\nsleep 0.05\n' + loop.group() + '\necho slot_released\n'
                process = subprocess.Popen([shutil.which('bash'), '-c', command], stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True, start_new_session=True)
                try:
                    output, _ = process.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.communicate()
                    self.fail('finished chunk keeps the admission loop waiting')
                self.assertEqual(process.returncode, 0)
                self.assertIn('slot_released', output)


if __name__ == '__main__':
    unittest.main()
