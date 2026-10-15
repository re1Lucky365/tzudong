"""One-time complete-tree seal; old maps, pins and failed observations are never replaced."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]


def main():
    for name in ('readiness-media-followup-20261011', 'tzuyang-review-minimal-20261011'):
        folder = ROOT / 'apps/web/performance' / name
        output = folder / 'artifact-map-v1.json'
        pin = ROOT / f'docs/evidence/{name}-map-v1.sha256'
        if output.exists() or pin.exists() or folder.is_symlink() or any(p.is_symlink() for p in folder.rglob('*')):
            raise ValueError('FRESH_NONALIAS_PACKET_REQUIRED')
        files = []
        for path in sorted(folder.rglob('*')):
            if not path.is_file():
                continue
            data = path.read_bytes()
            files.append({'path': path.relative_to(folder).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        packet = {'schemaVersion': 1, 'performanceAdmission': 0, 'physicalFieldAdmission': 0,
                  'operatingDDL': 0, 'operatingApplyAttempts': 1, 'operatingContentCommitsVerified': 0, 'artifacts': files}
        output.write_text(json.dumps(packet, ensure_ascii=False, indent=2) + '\n')
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        pin.write_text(digest + '\n')
        print(json.dumps({'package': name, 'files': len(files), 'mapSha256': digest}))


if __name__ == '__main__':
    main()
