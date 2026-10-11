const statuses = new Set(['keep', 'propose_fix', 'needs_visual', 'insufficient_source']);
export const issueCodes = ['INTERNAL_MARKER', 'RAW_FORMATTING', 'DUPLICATE_WITHIN_REVIEW',
  'BROKEN_PROSE', 'EDITORIAL_FIRST_PERSON', 'PROMOTIONAL_VOICE', 'CONTRADICTION',
  'RECORD_MISMATCH', 'EMPTY_REVIEW', 'NEEDS_VIDEO_EVIDENCE'];

/** Structural and exact-quote admission only; this does not certify semantic truth. */
export function validateSourceResponse(response, input) {
  if (response?.modelVersion !== 'gemini-3.8-flash' || response.candidates?.length !== 1
      || response.candidates[0].finishReason !== 'STOP') throw Error('SOURCE_MODEL_OR_FINISH_DENIED');
  const text = (response.candidates[0].content?.parts ?? [])
    .filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Error('SOURCE_JSON_DENIED'); }
  if (!Array.isArray(parsed?.rows) || Object.keys(parsed).length !== 1 || parsed.rows.length !== input.rows.length) throw Error('SOURCE_COVERAGE_DENIED');
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i], original = input.rows[i];
    if (Object.keys(row).sort().join(',') !== 'evidence,issues,key,revisedReview,status'
        || row.key !== original.key || !statuses.has(row.status) || typeof row.revisedReview !== 'string'
        || row.revisedReview.length > 8000 || Boolean(row.revisedReview.trim()) !== (row.status === 'propose_fix')
        || !Array.isArray(row.issues) || row.issues.length > 10 || new Set(row.issues).size !== row.issues.length
        || row.issues.some(code => !issueCodes.includes(code))
        || !Array.isArray(row.evidence) || row.evidence.length > 32) throw Error('SOURCE_ROW_DENIED');
    if (!original.review.trim() && row.status === 'propose_fix') throw Error('SOURCE_EMPTY_FILL_DENIED');
    if (row.status === 'propose_fix' && row.issues.some(code => ['CONTRADICTION','RECORD_MISMATCH'].includes(code))
        && row.evidence.length === 0) throw Error('SOURCE_FACTUAL_FIX_WITHOUT_CITATION_DENIED');
    for (const citation of row.evidence) {
      if (Object.keys(citation).sort().join(',') !== 'claim,quote,segment'
          || !Number.isInteger(citation.segment) || citation.segment < 0 || citation.segment >= input.segments.length
          || typeof citation.quote !== 'string' || !citation.quote.trim() || citation.quote.length > 2000
          || typeof citation.claim !== 'string' || !citation.claim.trim() || citation.claim.length > 1000
          || !input.segments[citation.segment].text.includes(citation.quote)) throw Error('SOURCE_CITATION_DENIED');
    }
  }
  return parsed.rows;
}
