import 'server-only';

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

const TZUDONG_VERCEL_PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
});

type AdminResult = Awaited<ReturnType<typeof requireAdmin>>;
type RequireAdmin = () => Promise<AdminResult>;

function fixedResponse(code: string, status: number) {
  return NextResponse.json({ code }, { headers: PRIVATE_HEADERS, status });
}

function fixedAuthFailure(response: NextResponse) {
  const status = response.status === 401 ? 401 : 403;
  return fixedResponse(
    status === 401 ? 'OPERATING_READBACK_UNAUTHORIZED' : 'OPERATING_READBACK_FORBIDDEN',
    status,
  );
}

function readRuntimeIdentity(environment: NodeJS.ProcessEnv) {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim() ?? '';
  const commit = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  if (environment.VERCEL !== '1'
    || environment.VERCEL_ENV !== 'production'
    || environment.VERCEL_TARGET_ENV !== 'production'
    || environment.VERCEL_PROJECT_ID !== TZUDONG_VERCEL_PROJECT_ID
    || environment.VERCEL_GIT_COMMIT_REF !== 'main'
    || !DEPLOYMENT_ID.test(deploymentId)
    || !GIT_SHA.test(commit)) {
    return null;
  }
  return Object.freeze({
    commit,
    deploymentId,
    holdActive: environment.ADMIN_RECORD_MUTATIONS_HOLD !== 'cleared',
  });
}

function responseAfterAuthentication(auth: AdminResult, environment: NodeJS.ProcessEnv) {
  if (!auth.ok) return fixedAuthFailure(auth.response);

  const readback = readRuntimeIdentity(environment);
  if (!readback) return fixedResponse('OPERATING_READBACK_RUNTIME_UNAVAILABLE', 503);
  return NextResponse.json(readback, { headers: PRIVATE_HEADERS, status: 200 });
}

export async function createRecordMutationsHoldReadbackResponse({
  environment = process.env,
  requireAdminImpl = requireAdmin,
}: {
  environment?: NodeJS.ProcessEnv;
  requireAdminImpl?: RequireAdmin;
} = {}) {
  let auth: AdminResult;
  try {
    auth = await requireAdminImpl();
  } catch {
    return fixedResponse('OPERATING_READBACK_AUTH_UNAVAILABLE', 503);
  }
  return responseAfterAuthentication(auth, environment);
}
