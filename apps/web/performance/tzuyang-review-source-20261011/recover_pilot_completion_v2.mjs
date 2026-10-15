// Read the existing immutable pilot response, preserving its older checkpoints.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { validateSourceResponse } from './source_response_v1.mjs';
const root = '/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const inputRaw = readFileSync(root + '/source-review-inputs-v1.json');
if (sha(inputRaw) !== 'd2cdce112686331429b30dc3684e8ab950a8cde21f7486311445714d0104aa67') throw Error('SOURCE_INPUT_DRIFT');
const input = JSON.parse(inputRaw), receipt = JSON.parse(readFileSync(root + '/source-pilot-job-v1.json'));
if (receipt.name !== 'batches/l7xlecdfbc2nw0x2r4yvtyxnqo5y38d7mo31'
  || receipt.requestSha256 !== 'e4cfb1cc22bc6c0060bfe3047a745edb5c9e3defe7d43c260d4a51f220d6f344') throw Error('SOURCE_PILOT_JOB_DRIFT');
const output = new URL('./pilot-completion-readback-v2.json', import.meta.url);
if (existsSync(output)) throw Error('SOURCE_PILOT_PROOF_EXISTS');
const env = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } } });
try {
  const job = await client.batches.get({ name: receipt.name });
  if (job.name !== receipt.name || job.state !== 'JOB_STATE_SUCCEEDED' || job.dest?.inlinedResponses?.length !== 3) throw Error('SOURCE_PILOT_COMPLETION_DRIFT');
  const responses = [];
  for (const entry of job.dest.inlinedResponses) {
    const source = input.requests.find(x => x.label === entry.metadata?.key);
    if (!source || entry.metadata.inputSha256 !== source.inputSha256) throw Error('SOURCE_PILOT_RESPONSE_DRIFT');
    const raw = readFileSync(root + '/source-pilot-' + source.label + '-v1.json'), old = JSON.parse(raw);
    const rows = validateSourceResponse(entry.response, source.content);
    if (!isDeepStrictEqual(rows, old.rows)) throw Error('SOURCE_PILOT_BODY_DRIFT');
    responses.push({ label: source.label, inputSha256: source.inputSha256, checkpointSha256: sha(raw),
      actualModelVersion: entry.response.modelVersion, finishReason: entry.response.candidates[0].finishReason,
      originalRowsEqualActualResponse: true, actualResponseRowsSha256: sha(JSON.stringify(rows)), rows: rows.length });
  }
  const result = { observedAtUtc: new Date().toISOString(), inputManifestSha256: sha(inputRaw),
    requestSha256: receipt.requestSha256, existingBatchReads: 1, newGenerations: 0, operatingWrites: 0, responses };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ responses: 3, rows: 4, finishReasons: responses.map(x => x.finishReason), originalRowsUnchanged: true }));
} catch (error) {
  console.log(JSON.stringify({ failureCode: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SOURCE_PILOT_READBACK_UNCONFIRMED', newGenerations: 0 })); process.exitCode = 1;
}
