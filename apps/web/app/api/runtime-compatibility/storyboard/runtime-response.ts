import 'server-only';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
  STORYBOARD_GEMINI_IMAGE_MODELS,
  STORYBOARD_GEMINI_PROVIDER_ID,
  STORYBOARD_GEMINI_TEXT_MODEL,
  isAllowedStoryboardGeminiWorkerModel,
  storyboardGeminiDeclaredModels,
} from '@/lib/admin/storyboard/gemini-models';
import {
  STORYBOARD_ARCHIVE_WORKFLOW,
  STORYBOARD_WORKFLOW,
  assertGeminiStoryboardExecutionPolicy,
  isExecutableStoryboardRequest,
  storyboardStoredProductionRequestSchema,
} from '@/lib/admin/storyboard/production-contract';
import { storyboardGeminiHeartbeatModelsSchema } from '@/lib/admin/storyboard/production-worker-auth';

const TZUDONG_VERCEL_PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
});
const SCHEMA_VERSION = 1;
const KIND = 'storyboard-runtime-compatibility';

function unavailable() {
  return NextResponse.json(
    { schemaVersion: SCHEMA_VERSION, kind: 'storyboard-runtime-compatibility-unavailable' },
    { headers: NO_STORE_HEADERS, status: 503 },
  );
}

function runtimeIdentity(environment: NodeJS.ProcessEnv) {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim() ?? '';
  const commit = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  if (environment.VERCEL !== '1'
    || environment.VERCEL_ENV !== 'production'
    || environment.VERCEL_TARGET_ENV !== 'production'
    || environment.VERCEL_PROJECT_ID !== TZUDONG_VERCEL_PROJECT_ID
    || environment.VERCEL_GIT_COMMIT_REF !== 'main'
    || !DEPLOYMENT_ID.test(deploymentId)
    || !GIT_SHA.test(commit)) return null;
  return Object.freeze({ commit, deploymentId });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** Evaluates code-shared admission only. It performs no provider, database, or network operation. */
export function publicStoryboardCanonicalPolicySha256(): string {
  const declaredModels = storyboardGeminiDeclaredModels();
  if (!storyboardGeminiHeartbeatModelsSchema.safeParse(declaredModels).success
    || declaredModels.some((model) => !isAllowedStoryboardGeminiWorkerModel(model))) {
    throw new Error('storyboard_policy_drift');
  }

  const textModels = [STORYBOARD_GEMINI_TEXT_MODEL];
  const imageModels = STORYBOARD_GEMINI_IMAGE_MODELS.map((model) => model.id);
  for (const textModel of textModels) {
    for (const imageModel of imageModels) {
      assertGeminiStoryboardExecutionPolicy({
        externalAI: true,
        text: { id: STORYBOARD_GEMINI_PROVIDER_ID, model: textModel },
        image: { id: STORYBOARD_GEMINI_PROVIDER_ID, model: imageModel },
      });
    }
  }

  const archivedRequest = storyboardStoredProductionRequestSchema.parse({
    workflow: STORYBOARD_ARCHIVE_WORKFLOW,
    requestId: '00000000-0000-4000-8000-000000000001',
    prompt: 'readback-only',
    sceneCount: 5,
    retrieval: 'none',
    sources: [],
    imageWidth: 1024,
    imageHeight: 576,
    providers: {
      externalAI: false,
      text: { id: 'local-mlx', model: 'legacy-read-only' },
      image: { id: 'manual', model: 'legacy-read-only' },
    },
  });
  if (isExecutableStoryboardRequest(archivedRequest)) throw new Error('storyboard_legacy_admission_drift');

  const canonicalPolicy = {
    defaultImageModel: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
    executionWorkflow: STORYBOARD_WORKFLOW,
    imageModels,
    legacyExecutionAdmission: 'blocked',
    provider: STORYBOARD_GEMINI_PROVIDER_ID,
    readableLegacyWorkflow: STORYBOARD_ARCHIVE_WORKFLOW,
    textModels,
  };
  return createHash('sha256').update(canonicalJson(canonicalPolicy), 'utf8').digest('hex');
}

export function createPublicStoryboardCompatibilityResponse({
  environment = process.env,
  policySha256 = publicStoryboardCanonicalPolicySha256,
}: {
  environment?: NodeJS.ProcessEnv;
  policySha256?: () => string;
} = {}) {
  const identity = runtimeIdentity(environment);
  if (!identity) return unavailable();

  let canonicalPolicySha256: string;
  try {
    canonicalPolicySha256 = policySha256();
  } catch {
    return unavailable();
  }
  if (!/^[0-9a-f]{64}$/.test(canonicalPolicySha256)) return unavailable();

  return NextResponse.json({
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    deploymentId: identity.deploymentId,
    commit: identity.commit,
    canonicalPolicySha256,
  }, { headers: NO_STORE_HEADERS, status: 200 });
}
