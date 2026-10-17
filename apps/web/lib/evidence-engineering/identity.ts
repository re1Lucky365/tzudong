import {
  DECLARED_NAVER_QUERY_STAGE_COUNT,
  EVIDENCE_FAMILIES,
  NAVER_QUERY_STAGES,
  NAME_COMPARE_MAX_CODE_POINTS,
  THESIS_PROXIMITY_RADIUS_METERS,
} from "./constants";
import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import { requireBoundedText, requireCalendarDate } from "./guards";
import type {
  ClosureIdentityRecord,
  EvidenceFamily,
  IdentityDecisionInput,
  IdentityMatchDecision,
  ReviewedOperationalStatus,
} from "./types";

const BROAD_STAGE_KIND = "broad";

export function levenshteinDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length > NAME_COMPARE_MAX_CODE_POINTS || b.length > NAME_COMPARE_MAX_CODE_POINTS) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidNameLength);
  }
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const leftCode = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = leftCode === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitution,
      );
    }
    for (let j = 0; j < previous.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function levenshteinSimilarity(left: string, right: string): number {
  const distance = levenshteinDistance(left, right);
  const denominator = Math.max(Array.from(left).length, Array.from(right).length);
  if (denominator === 0) return 1;
  return 1 - distance / denominator;
}

export function isInsideThesisProximityRadius(distanceMeters: number): boolean {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDistance);
  }
  return distanceMeters <= THESIS_PROXIMITY_RADIUS_METERS;
}

export function specifiedNaverQueryStage(stage: number): (typeof NAVER_QUERY_STAGES)[number] | null {
  return NAVER_QUERY_STAGES.find((candidate) => candidate.stage === stage) ?? null;
}

export function assertDeclaredQueryStage(stage: number): number {
  if (!Number.isInteger(stage) || stage < 1 || stage > DECLARED_NAVER_QUERY_STAGE_COUNT) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidQueryStage);
  }
  return stage;
}

export function isAutoConfirmableQueryStage(stage: number): boolean {
  const specified = specifiedNaverQueryStage(assertDeclaredQueryStage(stage));
  return specified !== null && specified.kind !== BROAD_STAGE_KIND;
}

function requireClosureRecord(record: ClosureIdentityRecord): ClosureIdentityRecord {
  return {
    ledgerId: requireBoundedText(record.ledgerId, 200, EvidenceContractCodes.invalidClosureRecord),
    businessAddress: requireBoundedText(record.businessAddress, 200, EvidenceContractCodes.invalidClosureRecord),
    effectiveOn: requireCalendarDate(record.effectiveOn),
    branchDistinction: requireBoundedText(record.branchDistinction, 200, EvidenceContractCodes.invalidClosureRecord),
    sourceUpdatedOn: requireCalendarDate(record.sourceUpdatedOn),
  };
}

function normalizeFamilies(families: readonly string[]): EvidenceFamily[] {
  const unique: EvidenceFamily[] = [];
  for (const family of families) {
    if (!(EVIDENCE_FAMILIES as readonly string[]).includes(family)) {
      throw new EvidenceContractError(EvidenceContractCodes.unknownEvidenceFamily);
    }
    const typed = family as EvidenceFamily;
    if (!unique.includes(typed)) unique.push(typed);
  }
  return unique;
}

export function resolveAutomaticIdentityState(input: IdentityDecisionInput): IdentityMatchDecision {
  if (input.queryStage !== null) assertDeclaredQueryStage(input.queryStage);
  if (input.closureRecord !== null) requireClosureRecord(input.closureRecord);
  const families = normalizeFamilies(input.evidenceFamilies);
  const closureComplete = input.closureRecord !== null;
  const exactStage = input.queryStage !== null && isAutoConfirmableQueryStage(input.queryStage);
  const supportedByIndependentEvidence = exactStage && !input.searchMiss && families.length >= 2;

  let state: IdentityMatchDecision["state"];
  if (input.evidenceConflicts || (closureComplete && supportedByIndependentEvidence)) {
    state = "conflict";
  } else if (closureComplete) {
    state = "closure_candidate";
  } else if (supportedByIndependentEvidence) {
    state = "supported";
  } else {
    state = "needs_review";
  }

  return {
    state,
    autoClosedStore: false,
    autoRelocated: false,
  };
}

export function applyReviewedOperationalStatus(
  review:
    | { moderation: "approved"; status: ReviewedOperationalStatus }
    | { moderation: "pending" | "rejected" },
): ReviewedOperationalStatus | "needs_review" {
  if (review.moderation !== "approved") return "needs_review";
  return review.status;
}
