"""Offline minimal-change plan; no account, provider, SQL or HTTP operation."""
from pathlib import Path
import hashlib
import json
import os
import re
import uuid

ROOT = Path('/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009')
SOURCE = 'b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8'
INPUT = 'd2cdce112686331429b30dc3684e8ab950a8cde21f7486311445714d0104aa67'
SPEC = 'eda1be50b7159b622211fd7e58609ff7287ca7994e80b44580faab5ac71a3041'


def sha(raw):
    return hashlib.sha256(raw if isinstance(raw, bytes) else raw.encode()).hexdigest()


def edit(row, spec, job):
    if row['adminLocked'] or row['channel_name'] != 'tzuyang' or row['status'] != 'approved':
        raise ValueError('MINIMAL_TARGET_SCOPE_DENIED')
    original = row['tzuyang_review']
    if sha(original) != row['reviewSha256']:
        raise ValueError('MINIMAL_PREIMAGE_DRIFT')
    value = original
    for before, after in spec['replacements']:
        if not before or value.count(before) != 1:
            raise ValueError('MINIMAL_REPLACEMENT_NOT_UNIQUE')
        value = value.replace(before, after, 1)
    if not value.strip() or value == original or len(value) > 4000:
        raise ValueError('MINIMAL_RESULT_DENIED')
    citations = spec.get('evidence', [])
    if spec['kind'] == 'source_correction' and not citations:
        raise ValueError('MINIMAL_SOURCE_REQUIRED')
    segments = {x['segment']: x['text'] for x in job['content']['segments']}
    for citation in citations:
        if not citation['quote'] or citation['quote'] not in segments.get(citation['segment'], ''):
            raise ValueError('MINIMAL_CITATION_DENIED')
    return value


def prepare():
    output = ROOT / 'minimal-review-plan-v1.json'
    target = Path(__file__).parent / 'minimal-review-plan-v1.json'
    if output.exists() or target.exists():
        raise ValueError('MINIMAL_PLAN_EXISTS')
    source_raw = (ROOT / 'restaurants-review-snapshot-v1.json').read_bytes()
    input_raw = (ROOT / 'source-review-inputs-v1.json').read_bytes()
    if sha(source_raw) != SOURCE or sha(input_raw) != INPUT:
        raise ValueError('MINIMAL_INPUT_DRIFT')
    source = json.loads(source_raw)
    inputs = json.loads(input_raw)
    spec_raw = (ROOT / 'minimal-edit-spec-v1.json').read_bytes()
    if sha(spec_raw) != SPEC:
        raise ValueError('MINIMAL_SPEC_DRIFT')
    specs = json.loads(spec_raw)
    plan = json.loads((ROOT / 'source-semantic-proposals-v2.json').read_bytes())
    complete = json.loads((Path(__file__).parent.parent / 'tzuyang-review-source-20261011/source-complete-v2.json').read_bytes())
    if complete['proposalPlanSha256'] != sha((ROOT / 'source-semantic-proposals-v2.json').read_bytes()):
        raise ValueError('MINIMAL_MODEL_PLAN_DRIFT')
    proposals = {x['key']: x for x in plan['rows']}
    jobs = {row['key']: job for job in inputs['requests'] for row in job['content']['rows']}
    if set(proposals) != set(specs) or len(specs) != 78:
        raise ValueError('MINIMAL_COVERAGE_DENIED')
    changed = []
    observations = []
    for key in sorted(specs):
        original = source[int(key[1:])]
        spec = specs[key]
        proposal = proposals[key]
        if original['reviewSha256'] != proposal['reviewSha256'] or original['recordSha256'] != proposal['recordSha256']:
            raise ValueError('MINIMAL_MODEL_PREIMAGE_DRIFT')
        state = spec['state']
        if original['adminLocked']:
            if state != 'preserve_admin_edit':
                raise ValueError('MINIMAL_ADMIN_EDIT_DENIED')
        elif state == 'minimal_draft':
            after = edit(original, spec, jobs[key])
            changed.append({'key': key, 'id': original['id'], 'updatedAt': original['updated_at'],
                            'recordSha256': original['recordSha256'], 'beforeSha256': sha(original['tzuyang_review']),
                            'after': after, 'afterSha256': sha(after), 'kind': spec['kind'],
                            'evidence': spec.get('evidence', []), 'adminLocked': False,
                            'wholeReviewFactCertified': False, 'guardedApplyPerformed': False})
        elif state != 'needs_context':
            raise ValueError('MINIMAL_STATE_DENIED')
        observations.append({'key': key, 'state': state, 'adminLocked': original['adminLocked'],
                             'reasonCode': spec['reasonCode'], 'wholeReviewFactCertified': False,
                             **({'kind': spec['kind'], 'afterSha256': sha(after), 'lengthDeltaCharacters': len(after)-len(original['tzuyang_review'])}
                                if state == 'minimal_draft' else {})})
    mismatches = []
    for job in inputs['requests']:
        text = '\n'.join(x['text'] for x in job['content']['segments'])
        latin = len(re.findall('[A-Za-z]', text))
        hangul = len(re.findall('[가-힣]', text))
        if job['content']['transcriptLanguage'] in ('ko', 'korean') and latin > 300 and latin / max(latin + hangul, 1) > .8:
            mismatches.append({'requestLabel': job['label'], 'latinLetters': latin, 'hangulLetters': hangul,
                               'reportedTranslationUncertain': job['content']['transcriptIsTranslatedOrUnconfirmed'],
                               'actualOriginalLanguageCertified': False})
    request = {'phase': 'preview', 'operationId': str(uuid.uuid4()), 'action': 'restaurant.edit',
               'targetIds': sorted(x['id'] for x in changed), 'payload': {'changes': {},
               'perTargetChanges': [{'id': x['id'], 'changes': {'tzuyang_review': x['after']}} for x in changed]}}
    if not 1 <= len(changed) <= 25:
        raise ValueError('MINIMAL_BATCH_LIMIT')
    private = {'sourceSha256': SOURCE, 'inputSha256': INPUT, 'specSha256': sha(spec_raw),
               'model': complete['actualModel'], 'thinkingLevel': complete['thinkingLevel'],
               'guardedPreviewApplyReadbackRequired': True, 'operatingWrites': 0, 'rows': changed, 'previewRequest': request}
    raw = (json.dumps(private, ensure_ascii=False, indent=2) + '\n').encode()
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as file:
        file.write(raw)
    result = {'sourceSha256': SOURCE, 'inputSha256': INPUT, 'specSha256': sha(spec_raw), 'privatePlanSha256': sha(raw),
              'reviewedCandidates': len(specs), 'minimalDrafts': len(changed),
              'preservedAdminEdits': sum(x['state'] == 'preserve_admin_edit' for x in observations),
              'needsContext': sum(x['state'] == 'needs_context' for x in observations),
              'editorialDrafts': sum(x['kind'] == 'editorial' for x in changed),
              'sourceCorrectionDrafts': sum(x['kind'] == 'source_correction' for x in changed),
              'metadataScriptMismatchHeuristic': mismatches, 'modelCensusRepeated': False,
              'semanticCertificationOfWholeReviews': False, 'operatingWrites': 0, 'observations': observations}
    with target.open('x') as file:
        file.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return {k: v for k, v in result.items() if k not in ('observations', 'metadataScriptMismatchHeuristic')}


if __name__ == '__main__':
    print(json.dumps(prepare()))
