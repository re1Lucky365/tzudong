import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { GenerateContentResponse } from '@google/genai';
import sharp from 'sharp';
import { GeminiThumbnailWorkerClient } from '../../lib/admin/youtube-thumbnail-generator/gemini-worker-client';
import { ThumbnailPrivateStore, type ThumbnailDatabase, type ThumbnailStorage } from '../../lib/admin/youtube-thumbnail-generator/private-store';
import { createThumbnailQueueApi } from '../../lib/admin/youtube-thumbnail-generator/queue-api';
import { parseThumbnail, thumbnailJob, thumbnailStartReceipt } from '../../lib/admin/youtube-thumbnail-generator/queue-contract';

// Actual route handlers + store + PG + Gemini client; synthetic HTTP Storage and provider, egress denied except owned PG.
const mode = process.argv[2]; const owner = process.env.FIXTURE_OWNER_ID!;
const quoted = (value: unknown) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
function sql(source: string) {
  const child = spawnSync(process.env.FIXTURE_PSQL!, ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', process.env.FIXTURE_PG_PORT!, '-U', 'postgres', '-d', 'postgres'], {
    input: source, encoding: 'utf8', timeout: 8000,
  });
  if (child.status !== 0) throw new Error('synthetic fixture SQL rejection');
  return child.stdout.trim() ? JSON.parse(child.stdout.trim()) : null;
}
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
sql(`UPDATE public.admin_thumbnail_workers SET token_sha256=${quoted(tokenHash)} WHERE token_sha256=${quoted(process.env.FIXTURE_TOKEN_0)};`);
let enqueueCalls = 0; let completeCalls = 0; let startCalls = 0; let sdkCalls = 0;
const rpcTypes: Record<string, string> = { p_owner_id: 'uuid', p_action: 'text', p_job_id: 'uuid', p_request_id: 'uuid',
  p_input_sha256: 'text', p_model: 'text', p_input: 'jsonb', p_token_sha256: 'text', p_attempt_id: 'uuid', p_fence: 'bigint', p_payload: 'jsonb' };
const database: ThumbnailDatabase = { rpc: async (name, args) => {
  assert.ok(['thumbnail_production_admin', 'thumbnail_production_auth_worker', 'thumbnail_production_worker'].includes(name));
  const params = Object.entries(args).map(([key, value]) => {
    assert.ok(Object.hasOwn(rpcTypes, key));
    return `${key}=>${quoted(rpcTypes[key] === 'jsonb' && value !== null ? JSON.stringify(value) : value)}::${rpcTypes[key]}`;
  });
  const data = sql(`SET ROLE service_role; SELECT public.${name}(${params.join(',')});`);
  if (args.p_action === 'enqueue') { enqueueCalls++; throw new Error('synthetic enqueue committed ACK loss'); }
  if (args.p_action === 'complete') {
    completeCalls++; if (mode === 'checkpoint-ack-lost') throw new Error('synthetic completion committed ACK loss');
  }
  if (args.p_action === 'start') {
    startCalls++; if (mode === 'start-ack-lost') throw new Error('synthetic start committed ACK loss');
  }
  return { data, error: null };
} };
const objects = new Map<string, Buffer>(); const uploaded: string[] = [];
let failedNormalized = false;
const storage: ThumbnailStorage = {
  read: async (path, maxBytes) => {
    const bytes = objects.get(path); assert.ok(!bytes || bytes.length <= maxBytes); return bytes ? Buffer.from(bytes) : null;
  },
  upload: async (path, bytes) => {
    uploaded.push(path); assert.ok(!objects.has(path));
    if (mode === 'normalize-recovery' && path.endsWith('normalized.png') && !failedNormalized) {
      failedNormalized = true; throw new Error('synthetic derivative upload loss before commit');
    }
    objects.set(path, Buffer.from(bytes));
    if (path.endsWith('original.png')) throw new Error('synthetic original committed ACK loss');
  },
};
const store = new ThumbnailPrivateStore(database, storage);
const api = createThumbnailQueueApi({ store, authorize: async () => ({ ok: true, userId: owner }) });
const origin = 'http://127.0.0.1:3000'; const base = `${origin}/api/admin/youtube-thumbnail-generator`;
const image = await sharp({ create: { width: 512, height: 288, channels: 3, background: '#b67821' } }).png().toBuffer();
const form = new FormData(); const requestId = randomUUID();
form.set('request', JSON.stringify({ requestId, model: 'gemini-3.1-flash-image', roles: ['food'],
  brief: { topic: '맛있는 한 상', headline: '따뜻한 한 끼', stylePreset: 'grilled-meat-feast', acknowledgedSafety: true } }));
form.set('reference0', new File([new Uint8Array(image)], 'food.png', { type: 'image/png' }));
const enqueued = await api.listPOST(new Request(`${base}/jobs`, { method: 'POST', headers: { Origin: origin }, body: form }));
assert.equal(enqueued.status, 200); const queued = parseThumbnail(thumbnailJob, (await enqueued.json()).job);
assert.equal(queued.requestId, requestId); assert.equal(enqueueCalls, 1);
async function operation(payload: unknown) {
  return await api.workerPOST(new Request(`${base}/worker`, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(payload) }));
}
const claim = await operation({ action: 'claim' }); assert.equal(claim.status, 200);
const job = parseThumbnail(thumbnailJob, (await claim.json()).result);
const attempt = { jobId: job.id, attemptId: job.attemptId!, fence: job.fence, inputSha256: job.inputSha256 };
const referenceResponse = await api.workerReferenceGET(new Request(`${base}/worker/references?${new URLSearchParams({
  ...attempt, fence: String(attempt.fence), index: '0',
})}`, { headers: { Authorization: `Bearer ${token}` } }));
assert.equal(referenceResponse.status, 200);
const reference = new Uint8Array(await referenceResponse.arrayBuffer());
const client = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
  generateContent: async () => {
    sdkCalls++; const response = new GenerateContentResponse(); response.modelVersion = job.model;
    response.responseId = 'synthetic-pg-private-store'; response.candidates = [{ content: { parts: [{ inlineData: {
      mimeType: 'image/png', data: image.toString('base64'),
    } }] } }]; return response;
  },
} } });
const prepared = await client.prepare({ ownerId: owner, jobId: job.id, attemptId: job.attemptId!, fence: job.fence,
  model: job.model, prompt: job.input.prompt, references: [{ bytes: reference, mimeType: 'image/png', role: 'food' }] });
assert.equal(prepared.descriptor.inputSha256, job.inputSha256);
let completed = false;
if (mode === 'start-ack-lost') {
  await assert.rejects(prepared.run(async () => {
    const response = await operation({ action: 'start', ...attempt }); assert.equal(response.status, 503);
    throw new Error('synthetic start permission unavailable');
  }), { code: 'start_not_confirmed' });
  assert.equal(sdkCalls, 0);
  assert.equal((await operation({ action: 'unknown', ...attempt })).status, 200);
  const next = await operation({ action: 'claim' }); assert.equal((await next.json()).result, null);
} else {
  const result = await prepared.run(async () => {
    const response = await operation({ action: 'start', ...attempt }); assert.equal(response.status, 200);
    return parseThumbnail(thumbnailStartReceipt, (await response.json()).result);
  });
  const output = new FormData(); output.set('attempt', JSON.stringify(attempt)); output.set('provenance', JSON.stringify(result.provenance));
  output.set('original', new File([new Uint8Array(result.original.bytes)], 'original.png', { type: result.original.mimeType }));
  let response = await api.workerImagePOST(new Request(`${base}/worker/images`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: output }));
  if (mode === 'normalize-recovery') {
    assert.equal(response.status, 503); assert.equal(completeCalls, 0);
    response = await operation({ action: 'recover', ...attempt });
  }
  assert.equal(response.status, 200); const finished = parseThumbnail(thumbnailJob, (await response.json()).job);
  assert.equal(finished.state, 'succeeded'); assert.equal(completeCalls, 1); assert.equal(sdkCalls, 1);
  const readback = await api.jobGET(new Request(`${base}/jobs/${job.id}?variant=original`), { params: Promise.resolve({ jobId: job.id }) });
  assert.equal(readback.status, 200); assert.deepEqual(Buffer.from(await readback.arrayBuffer()), image);
  assert.equal(uploaded.filter((path) => path.endsWith('original.png')).length, 1); completed = true;
}
assert.equal(startCalls, 1);
process.stdout.write(JSON.stringify({ mode, realPostgres: true, actualApiHandlers: true, inputBound: true,
  sdkCalls, startCalls, enqueueCalls, completeCalls, completed, storageSynthetic: true, externalProviderCalls: 0 }) + '\n');
