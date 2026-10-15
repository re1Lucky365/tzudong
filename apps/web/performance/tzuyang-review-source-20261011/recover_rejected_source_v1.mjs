// Read back one existing batch; no new generation, model change or DB write.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
const root = '/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const raw = readFileSync(root + '/source-review-inputs-v1.json');
if (sha(raw) !== 'd2cdce112686331429b30dc3684e8ab950a8cde21f7486311445714d0104aa67') throw Error('SOURCE_INPUT_DRIFT');
const input = JSON.parse(raw);
const receipt = JSON.parse(readFileSync(root + '/source-remainder-job-v1.json'));
if (receipt.name !== 'batches/uq9p1nluzwuhj6s6fcte217ukajs62rpcsql'
  || receipt.requestSha256 !== '2612110eecb61ea7c3876da6aed4b8281916338b29746e5e2eeb69efaae7c139') throw Error('SOURCE_JOB_DRIFT');
const env = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } } });
try {
  const job = await client.batches.get({ name: receipt.name });
  if (job.name !== receipt.name || job.state !== 'JOB_STATE_SUCCEEDED') throw Error('SOURCE_JOB_NOT_COMPLETE');
  const result = [];
  for (const label of ['2002', '2053', '2101']) {
    const source = input.requests.find(x => x.label === label);
    const entry = job.dest?.inlinedResponses?.find(x => x.metadata?.key === label);
    if (!entry || entry.metadata.inputSha256 !== source.inputSha256 || entry.response?.modelVersion !== 'gemini-3.8-flash') throw Error('SOURCE_RESPONSE_DRIFT');
    const filename = root + '/source-remainder-rejected-' + label + '-v1.json';
    const envelope = JSON.stringify({ label, requestSha256: receipt.requestSha256, inputSha256: source.inputSha256,
      originalAdmission: 'SOURCE_CITATION_DENIED', independentlyCertified: false, entry }, null, 2) + '\n';
    if (!existsSync(filename)) writeFileSync(filename, envelope, { mode: 0o600, flag: 'wx' });
    else if (readFileSync(filename, 'utf8') !== envelope) throw Error('SOURCE_REJECTED_CHECKPOINT_DRIFT');
    const text = entry.response.candidates[0].content.parts.filter(x => !x.thought && typeof x.text === 'string').map(x => x.text).join('');
    const rows = JSON.parse(text).rows;
    for (const row of rows) for (const cite of row.evidence) {
      if (!source.content.segments[cite.segment]?.text.includes(cite.quote)) result.push({ label, key: row.key,
        declaredSegment: cite.segment, quoteSha256: sha(cite.quote),
        exactOtherSegments: source.content.segments.filter(x => x.text.includes(cite.quote)).map(x => x.segment),
        stillRejected: true });
    }
  }
  console.log(JSON.stringify({ existingBatchReads: 1, newGenerations: 0, operatingWrites: 0,
    mismatchEvidence: result, sourceInputSha256: sha(raw), actualModel: 'gemini-3.8-flash', thinkingLevel: 'HIGH' }));
} catch (error) {
  console.log(JSON.stringify({ failureCode: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SOURCE_READBACK_UNCONFIRMED',
    blindCreateRetryAllowed: false, operatingWrites: 0 })); process.exitCode = 1;
}
