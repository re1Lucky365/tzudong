import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceResponse} from './source_response_v1.mjs';

const input = {rows: [{key:'r0001',review:'국물이 따뜻합니다.'}, {key:'r0002',review:''}],
  segments:[{segment:0,startSeconds:12,text:'국물이 조금 짜고 고기는 부드러워요.'}]};
const rows = [{key:'r0001',status:'propose_fix',issues:['CONTRADICTION'],revisedReview:'쯔양은 국물이 조금 짜다고 평가했습니다.',
  evidence:[{segment:0,quote:'국물이 조금 짜고',claim:'국물이 짜다는 평가'}]},
{key:'r0002',status:'insufficient_source',issues:['EMPTY_REVIEW'],revisedReview:'',evidence:[]}];
function response(value=rows) { return {modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'STOP',
  content:{parts:[{thought:true,text:'never persisted'},{text:JSON.stringify({rows:value})}]}}]}; }

test('admits bounded ordered results with exact source quotation, without certifying meaning',()=>{
  assert.deepEqual(validateSourceResponse(response(),input),rows);
});
test('rejects wrong model and nonterminal finish',()=>{
  const wrong=response();wrong.modelVersion='other';assert.throws(()=>validateSourceResponse(wrong,input),/SOURCE_MODEL_OR_FINISH_DENIED/);
  const truncated=response();truncated.candidates[0].finishReason='MAX_TOKENS';assert.throws(()=>validateSourceResponse(truncated,input),/SOURCE_MODEL_OR_FINISH_DENIED/);
});
test('rejects missing, reordered or duplicate input keys',()=>{
  assert.throws(()=>validateSourceResponse(response(rows.slice(0,1)),input),/SOURCE_COVERAGE_DENIED/);
  assert.throws(()=>validateSourceResponse(response([...rows].reverse()),input),/SOURCE_ROW_DENIED/);
  assert.throws(()=>validateSourceResponse(response([rows[0],rows[0]]),input),/SOURCE_ROW_DENIED/);
});
test('rejects paraphrased evidence and guessed segment indices',()=>{
  const changed=structuredClone(rows);changed[0].evidence[0].quote='국물이 아주 싱거워요';
  assert.throws(()=>validateSourceResponse(response(changed),input),/SOURCE_CITATION_DENIED/);
  const timing=structuredClone(rows);timing[0].evidence[0].segment=99;
  assert.throws(()=>validateSourceResponse(response(timing),input),/SOURCE_CITATION_DENIED/);
});
test('rejects a generated review for empty source and prose for unresolved evidence',()=>{
  const invented=structuredClone(rows);invented[1].status='propose_fix';invented[1].revisedReview='쯔양은 극찬했습니다.';
  assert.throws(()=>validateSourceResponse(response(invented),input),/SOURCE_EMPTY_FILL_DENIED/);
  const unresolved=structuredClone(rows);unresolved[0].status='needs_visual';
  assert.throws(()=>validateSourceResponse(response(unresolved),input),/SOURCE_ROW_DENIED/);
});
test('rejects extra provider text fields rather than persisting them',()=>{
  const extra=structuredClone(rows);extra[0].internalReasoning='not permitted';
  assert.throws(()=>validateSourceResponse(response(extra),input),/SOURCE_ROW_DENIED/);
});
test('factual replacements require a citation while formatting-only proposals can omit one',()=>{
  const uncited=structuredClone(rows);uncited[0].evidence=[];
  assert.throws(()=>validateSourceResponse(response(uncited),input),/SOURCE_FACTUAL_FIX_WITHOUT_CITATION_DENIED/);
  uncited[0].issues=['BROKEN_PROSE'];
  assert.equal(validateSourceResponse(response(uncited),input)[0].status,'propose_fix');
});
