// Read-only bounded proposal preflight. Never writes restaurant/media/auth data.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
const privateRoot = '/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const planRaw = readFileSync(privateRoot + '/source-semantic-proposals-v2.json');
const evidence = JSON.parse(readFileSync(new URL('./source-complete-v2.json', import.meta.url)));
if (createHash('sha256').update(planRaw).digest('hex') !== evidence.proposalPlanSha256) throw Error('SOURCE_PROPOSAL_BINDING_DRIFT');
const plan = JSON.parse(planRaw), snapshot = JSON.parse(readFileSync(privateRoot + '/restaurants-review-snapshot-v1.json'));
const output = new URL('./fresh-proposal-preflight-v2.json', import.meta.url);
if (existsSync(output)) throw Error('SOURCE_PREFLIGHT_EXISTS');
const env = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'https://aqlcofblfxdrjhhdmarw.supabase.co' || !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('SOURCE_PROJECT_BINDING_DENIED');
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) }) },
});
const columns = 'id,origin_name,approved_name,channel_name,status,youtube_link,youtube_meta,tzuyang_review,updated_at,updated_by_admin_id';
try {
  const observations = []; let requests = 0;
  for (let i = 0; i < plan.rows.length; i += 25) {
    const batch = plan.rows.slice(i, i + 25); requests++;
    const reply = await client.from('restaurants').select(columns).in('id', batch.map(x => x.id)).limit(25);
    if (reply.error || !Array.isArray(reply.data) || reply.data.length !== batch.length) throw Error('SOURCE_FRESH_COVERAGE_DENIED');
    for (const item of batch) {
      const fresh = reply.data.find(x => x.id === item.id), original = snapshot[Number(item.key.slice(1))];
      if (!fresh) throw Error('SOURCE_FRESH_ROW_MISSING');
      const same = fresh.id === original.id && fresh.status === 'approved' && fresh.channel_name === 'tzuyang'
        && sha(fresh.tzuyang_review ?? '') === original.reviewSha256 && fresh.updated_at === original.updated_at
        && (fresh.updated_by_admin_id != null) === original.adminLocked && sha(fresh) === original.recordSha256;
      observations.push({ key: item.key, exactPreimageUnchanged: same, currentRecordSha256: sha(fresh),
        currentReviewSha256: sha(fresh.tzuyang_review ?? ''), adminLocked: fresh.updated_by_admin_id != null,
        independentSemanticApproval: false, operatingApplied: false });
    }
  }
  const result = { observedAtUtc: new Date().toISOString(), projectRef: 'aqlcofblfxdrjhhdmarw', requests,
    records: observations.length, unchanged: observations.filter(x => x.exactPreimageUnchanged).length,
    changed: observations.filter(x => !x.exactPreimageUnchanged).length,
    proposalPlanSha256: evidence.proposalPlanSha256, operatingWrites: 0,
    personalIdentifiersPersisted: false, freshPreflightIsNotApplyPermission: true, observations };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ records: result.records, unchanged: result.unchanged, changed: result.changed, requests, operatingWrites: 0 }));
} catch (error) {
  console.log(JSON.stringify({ failureCode: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SOURCE_FRESH_READ_UNCONFIRMED', operatingWrites: 0 })); process.exitCode = 1;
}
