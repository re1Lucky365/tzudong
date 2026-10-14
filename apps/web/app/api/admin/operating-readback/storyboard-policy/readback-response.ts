import 'server-only';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
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
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
});

const POLICY_SOURCE_PATHS = Object.freeze([
  ['declared-models', 'apps/web/lib/admin/storyboard/gemini-models.ts'],
  ['production-request-admission', 'apps/web/lib/admin/storyboard/production-contract.ts'],
  ['worker-heartbeat-admission', 'apps/web/lib/admin/storyboard/production-worker-auth.ts'],
  ['outbound-worker-execution', 'apps/web/lib/admin/storyboard/outbound-worker.ts'],
] as const);

type AdminResult = Awaited<ReturnType<typeof requireAdmin>>;
type RequireAdmin = () => Promise<AdminResult>;

function fixedResponse(code: string, status: number) {
  return NextResponse.json({ code }, { headers: PRIVATE_HEADERS, status });
}

function fixedAuthFailure(response: NextResponse) {
  const status = response.status === 401 ? 401 : 403;
  return fixedResponse(
    status === 401 ? 'STORYBOARD_POLICY_READBACK_UNAUTHORIZED' : 'STORYBOARD_POLICY_READBACK_FORBIDDEN',
    status,
  );
}

function readRuntimeIdentity(environment: NodeJS.ProcessEnv) {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim() ?? '';
  const sourceCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  if (environment.VERCEL !== '1'
    || environment.VERCEL_ENV !== 'production'
    || environment.VERCEL_TARGET_ENV !== 'production'
    || environment.VERCEL_PROJECT_ID !== TZUDONG_VERCEL_PROJECT_ID
    || environment.VERCEL_GIT_COMMIT_REF !== 'main'
    || !DEPLOYMENT_ID.test(deploymentId)
    || !GIT_SHA.test(sourceCommit)) {
    return null;
  }
  return Object.freeze({
    branch: 'main' as const,
    deploymentId,
    projectId: TZUDONG_VERCEL_PROJECT_ID,
    sourceCommit,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function evaluateStoryboardRuntimePolicy() {
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

  const canonicalPolicy = Object.freeze({
    defaultImageModel: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL,
    executionWorkflow: STORYBOARD_WORKFLOW,
    imageModels,
    legacyExecutionAdmission: 'blocked' as const,
    provider: STORYBOARD_GEMINI_PROVIDER_ID,
    readableLegacyWorkflow: STORYBOARD_ARCHIVE_WORKFLOW,
    textModels,
  });
  const canonicalPolicySha256 = createHash('sha256').update(canonicalJson(canonicalPolicy), 'utf8').digest('hex');
  return Object.freeze({ canonicalPolicy, canonicalPolicySha256 });
}

type PolicyEvaluation = ReturnType<typeof evaluateStoryboardRuntimePolicy>;

function responseAfterAuthentication(
  auth: AdminResult,
  environment: NodeJS.ProcessEnv,
  evaluatePolicy: () => PolicyEvaluation,
) {
  if (!auth.ok) return fixedAuthFailure(auth.response);

  const deployment = readRuntimeIdentity(environment);
  if (!deployment) return fixedResponse('STORYBOARD_POLICY_READBACK_RUNTIME_UNAVAILABLE', 503);

  let evaluated: PolicyEvaluation;
  try {
    evaluated = evaluatePolicy();
  } catch {
    return fixedResponse('STORYBOARD_POLICY_READBACK_POLICY_UNAVAILABLE', 503);
  }
  const executionPaths = POLICY_SOURCE_PATHS.map(([id, sourcePath]) => ({
    canonicalPolicySha256: evaluated.canonicalPolicySha256,
    deploymentId: deployment.deploymentId,
    id,
    sourceCommit: deployment.sourceCommit,
    sourcePath,
  }));

  return NextResponse.json({
    schemaVersion: 1,
    deployment,
    policy: {
      ...evaluated.canonicalPolicy,
      canonicalPolicySha256: evaluated.canonicalPolicySha256,
    },
    executionPaths,
    verification: {
      databaseCutover: 'not-verified',
      outboundProviderCall: 'not-performed',
      providerAccess: 'not-verified',
      runtimePolicyEvaluated: true,
    },
  }, { headers: PRIVATE_HEADERS, status: 200 });
}

export async function createStoryboardPolicyReadbackResponse({
  environment = process.env,
  evaluatePolicy = evaluateStoryboardRuntimePolicy,
  requireAdminImpl = requireAdmin,
}: {
  environment?: NodeJS.ProcessEnv;
  evaluatePolicy?: () => PolicyEvaluation;
  requireAdminImpl?: RequireAdmin;
} = {}) {
  let auth: AdminResult;
  try {
    auth = await requireAdminImpl();
  } catch {
    return fixedResponse('STORYBOARD_POLICY_READBACK_AUTH_UNAVAILABLE', 503);
  }
  return responseAfterAuthentication(auth, environment, evaluatePolicy);
}
