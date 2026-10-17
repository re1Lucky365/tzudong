import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import {
  isPopularityTier,
  requireCanonicalKey,
  requireIsoTimestamp,
  requireVersionToken,
  safeCount,
} from "./guards";
import type {
  FetchDecision,
  FetchRetryBudget,
  PopularityMetricRecord,
  PopularityTierAssignment,
  ScoringCohortIdentity,
} from "./types";

export function classifyFetch(status: number, challenge: boolean): FetchDecision {
  if (challenge || status === 401 || status === 403) return "stop_source";
  if (status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599)) return "retry_later";
  if (Number.isInteger(status) && status >= 200 && status < 300) return "accept";
  return "stop_source";
}

export function mayRetryFetch(decision: FetchDecision, budget: FetchRetryBudget): boolean {
  if (decision !== "retry_later") return false;
  if (budget.circuitOpen) return false;
  if (!Number.isSafeInteger(budget.attemptsUsed) || budget.attemptsUsed < 0) return false;
  if (!Number.isSafeInteger(budget.maxAttempts) || budget.maxAttempts < 0) return false;
  if (budget.attemptsUsed >= budget.maxAttempts) return false;
  if (budget.retryAfterSeconds !== null) {
    if (!Number.isFinite(budget.retryAfterSeconds) || budget.retryAfterSeconds < 0) return false;
  }
  if (!Number.isSafeInteger(budget.dailyRemaining) || budget.dailyRemaining < 1) return false;
  return true;
}

export function parseTierAssignment(input: PopularityTierAssignment): PopularityTierAssignment {
  if (!isPopularityTier(input.popularity_tier)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidPopularityTier);
  }
  if (!Number.isFinite(input.popularity_score)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidPopularityScore);
  }
  return {
    scoring_version: requireVersionToken(input.scoring_version, EvidenceContractCodes.invalidScoringVersion),
    cohort_version: requireVersionToken(input.cohort_version, EvidenceContractCodes.invalidCohortVersion),
    computed_at: requireIsoTimestamp(input.computed_at),
    popularity_tier: input.popularity_tier,
    popularity_score: input.popularity_score,
  };
}

export function assertSameScoringCohort(
  assignments: readonly PopularityTierAssignment[],
): ScoringCohortIdentity {
  const parsedAssignments = assignments.map(parseTierAssignment);
  const first = parsedAssignments[0];
  if (!first) {
    throw new EvidenceContractError(EvidenceContractCodes.emptyCohort);
  }
  for (const parsed of parsedAssignments.slice(1)) {
    if (
      parsed.scoring_version !== first.scoring_version ||
      parsed.cohort_version !== first.cohort_version ||
      parsed.computed_at !== first.computed_at
    ) {
      throw new EvidenceContractError(EvidenceContractCodes.mixedScoringCohort);
    }
  }
  return {
    scoring_version: first.scoring_version,
    cohort_version: first.cohort_version,
    computed_at: first.computed_at,
  };
}

export function parsePopularityMetric(input: PopularityMetricRecord): PopularityMetricRecord {
  const assignment = parseTierAssignment(input);
  const sourceRevision = safeCount(input.source_revision, Number.MAX_SAFE_INTEGER);
  if (sourceRevision === null) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidSourceRevision);
  }
  return {
    canonical_key: requireCanonicalKey(input.canonical_key),
    source_revision: sourceRevision,
    scoring_version: assignment.scoring_version,
    cohort_version: assignment.cohort_version,
    popularity_score: assignment.popularity_score,
    popularity_tier: assignment.popularity_tier,
    computed_at: assignment.computed_at,
  };
}
