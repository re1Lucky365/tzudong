// Pure checkpoint reduction; no provider call, credentials or operating write.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateSourceResponse } from './source_response_v1.mjs';
const privateRoot = '/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const sourceRaw = readFileSync(privateRoot + '/restaurants-review-snapshot-v1.json');
const inputRaw = readFileSync(privateRoot + '/source-review-inputs-v1.json');
if (sha(sourceRaw) !== 'b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8'
  || sha(inputRaw) !== 'd2cdce112686331429b30dc3684e8ab950a8cde21f7486311445714d0104aa67') throw Error('SOURCE_AGGREGATE_INPUT_DRIFT');
const source = JSON.parse(sourceRaw), input = JSON.parse(inputRaw);
const promptSha256 = sha(readFileSync(new URL('./source-review-prompt-v1.txt', import.meta.url)));
const pilotProofRaw = readFileSync(new URL('./pilot-completion-readback-v2.json', import.meta.url));
const pilotProof = JSON.parse(pilotProofRaw);
if (pilotProof.inputManifestSha256 !== sha(inputRaw)
  || pilotProof.requestSha256 !== 'e4cfb1cc22bc6c0060bfe3047a745edb5c9e3defe7d43c260d4a51f220d6f344') throw Error('SOURCE_PILOT_PROOF_DRIFT');
const stats = {}, locked = {}, issueCounts = {}, rows = [], plans = [], seen = new Set();
const usage = { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 0 };
let admittedRequests = 0, rejectedRequests = 0;
for (const job of input.requests) {
  const names = ['pilot','remainder'].map(phase => privateRoot + '/source-' + phase + '-' + job.label + '-v1.json').filter(existsSync);
  if (names.length > 1) throw Error('SOURCE_DUPLICATE_CHECKPOINT');
  const originals = job.content.rows.map(x => ({ row: source[Number(x.key.slice(1))], model: x }));
  if (names.length === 0) {
    const rejectedRaw = readFileSync(privateRoot + '/source-remainder-rejected-' + job.label + '-v1.json');
    const rejected = JSON.parse(rejectedRaw);
    if (rejected.inputSha256 !== job.inputSha256 || rejected.entry.response.modelVersion !== 'gemini-3.8-flash') throw Error('SOURCE_REJECTED_BINDING_DRIFT');
    rejectedRequests++;
    for (const key of Object.keys(usage)) usage[key] += rejected.entry.response.usageMetadata?.[key] ?? 0;
    for (const { row, model } of originals) rows.push({ key: model.key, status: 'quote_rejected', adminLocked: row.adminLocked,
      originalReviewSha256: row.reviewSha256, modelProposalAdmitted: false, checkpointSha256: sha(rejectedRaw) });
    continue;
  }
  const checkpointRaw = readFileSync(names[0]), checkpoint = JSON.parse(checkpointRaw);
  if (checkpoint.inputManifestSha256 !== sha(inputRaw) || checkpoint.inputSha256 !== job.inputSha256
    || checkpoint.promptSha256 !== promptSha256 || checkpoint.thinkingLevel !== 'HIGH'
    || !isDeepStrictEqual(checkpoint.sourceBinding, job.sourceBinding)) throw Error('SOURCE_CHECKPOINT_DRIFT');
  let finishReason = checkpoint.finishReason;
  if (finishReason === undefined) {
    const proof = pilotProof.responses.find(x => x.label === job.label);
    if (!proof || proof.inputSha256 !== job.inputSha256 || proof.checkpointSha256 !== sha(checkpointRaw)
      || proof.actualModelVersion !== checkpoint.actualModelVersion || proof.originalRowsEqualActualResponse !== true
      || proof.actualResponseRowsSha256 !== sha(JSON.stringify(checkpoint.rows))) throw Error('SOURCE_PILOT_FINISH_PROOF_DENIED');
    finishReason = proof.finishReason;
  }
  const admitted = validateSourceResponse({ modelVersion: checkpoint.actualModelVersion,
    candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ rows: checkpoint.rows }) }] } }] }, job.content);
  admittedRequests++;
  for (const key of Object.keys(usage)) usage[key] += checkpoint.usage?.[key] ?? 0;
  for (const item of admitted) {
    const original = source[Number(item.key.slice(1))];
    if (seen.has(item.key)) throw Error('SOURCE_ROW_DUPLICATE'); seen.add(item.key);
    stats[item.status] = (stats[item.status] ?? 0) + 1;
    const lockKey = item.status + ':' + (original.adminLocked ? 'locked' : 'unlocked');
    locked[lockKey] = (locked[lockKey] ?? 0) + 1;
    for (const code of item.issues) issueCounts[code] = (issueCounts[code] ?? 0) + 1;
    rows.push({ key: item.key, status: item.status, adminLocked: original.adminLocked,
      issues: item.issues, originalReviewSha256: original.reviewSha256,
      proposalSha256: item.revisedReview ? sha(item.revisedReview) : null, checkpointSha256: sha(checkpointRaw),
      exactCitationCount: item.evidence.length, independentSemanticApproval: false, operatingApplied: false });
    if (item.status === 'propose_fix') plans.push({ key: item.key, id: original.id, updatedAt: original.updated_at,
      recordSha256: original.recordSha256, reviewSha256: original.reviewSha256, adminLocked: original.adminLocked,
      proposal: item.revisedReview, proposalSha256: sha(item.revisedReview), evidence: item.evidence,
      transcriptSha256: job.sourceBinding.transcriptSha256, independentSemanticApproval: false, applyAllowed: false });
  }
}
if (rows.length !== 161 || new Set(rows.map(x => x.key)).size !== 161 || admittedRequests !== 134 || rejectedRequests !== 3) throw Error('SOURCE_AGGREGATE_COVERAGE_DRIFT');
const planRaw = JSON.stringify({ inputSha256: sha(inputRaw), reviewedModel: 'gemini-3.8-flash', thinkingLevel: 'HIGH', rows: plans }, null, 2) + '\n';
const planPath = privateRoot + '/source-semantic-proposals-v2.json';
if (!existsSync(planPath)) writeFileSync(planPath, planRaw, { flag: 'wx', mode: 0o600 });
else if (readFileSync(planPath, 'utf8') !== planRaw) throw Error('SOURCE_PRIVATE_PLAN_DRIFT');
const report = { frozenCensusRecords: 1659, approvedTzuyangRecords: 751,
  sourceReviewRecords: 161, completedRequests: 137, admittedRequests, rejectedRequests,
  structurallyAndQuoteAdmittedRows: 156, rejectedRows: 5, actualModel: 'gemini-3.8-flash', thinkingLevel: 'HIGH',
  inputSha256: sha(inputRaw), sourceSha256: sha(sourceRaw), promptSha256, pilotCompletionProofSha256: sha(pilotProofRaw), stats, locked, issueCounts, usage,
  proposalPlanSha256: sha(planRaw), originalModelKeepRowsOutsideSourceStage: 590,
  sourceSemanticCertification: false, videoVisualCertification: false,
  operatingWrites: 0, newGenerations: 0, additionalCapacityPurchase: false, billingAmountKnown: false,
  observations: rows.sort((a,b) => a.key.localeCompare(b.key)) };
const output = new URL('./source-complete-v2.json', import.meta.url);
if (existsSync(output)) throw Error('SOURCE_PUBLIC_EVIDENCE_EXISTS');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ records: 161, admittedRows: 156, rejectedRows: 5, stats, locked, operatingWrites: 0 }));
