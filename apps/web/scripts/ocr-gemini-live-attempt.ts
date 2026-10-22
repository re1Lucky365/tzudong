export type OcrGeminiLiveAttemptState = {
  generationCallsStarted: number;
  generationRequestsAdmitted: number;
  providerRequestsStarted: number;
};

type PersistAttemptState = (next: Readonly<OcrGeminiLiveAttemptState>) => void;

export function createOcrGeminiLiveAttemptState(): OcrGeminiLiveAttemptState {
  return {
    generationCallsStarted: 0,
    generationRequestsAdmitted: 0,
    providerRequestsStarted: 0,
  };
}

export function recordModelMetadataRequest(
  state: OcrGeminiLiveAttemptState,
  persist: PersistAttemptState,
): void {
  const next = {
    ...state,
    providerRequestsStarted: state.providerRequestsStarted + 1,
  };
  persist(next);
  Object.assign(state, next);
}

export function assertExpectedModelIdentity(metadataName: string | undefined, expectedModel: string): void {
  if (metadataName?.replace(/^models\//, '') !== expectedModel) {
    throw new Error('model_identity_mismatch');
  }
}

export function recordGenerationCallStarted(
  state: OcrGeminiLiveAttemptState,
  persist: PersistAttemptState,
): void {
  if (state.generationCallsStarted !== 0) throw new Error('attempt_bound_exceeded');
  const next = {
    ...state,
    generationCallsStarted: 1,
  };
  persist(next);
  Object.assign(state, next);
}

export async function invokeAdmittedGeneration<T>(
  state: OcrGeminiLiveAttemptState,
  persist: PersistAttemptState,
  invoke: () => Promise<T>,
): Promise<T> {
  if (state.generationCallsStarted !== 1 || state.generationRequestsAdmitted !== 0) {
    throw new Error('attempt_bound_exceeded');
  }
  const next = {
    ...state,
    generationRequestsAdmitted: 1,
    providerRequestsStarted: state.providerRequestsStarted + 1,
  };
  // Persist and fsync the admitted state before provider access. If persistence
  // fails, the invocation is never made and the in-memory state remains exact.
  persist(next);
  Object.assign(state, next);
  return invoke();
}

export function isGenerationDeliveryUnknown(state: Readonly<OcrGeminiLiveAttemptState>): boolean {
  return state.generationRequestsAdmitted > 0;
}
