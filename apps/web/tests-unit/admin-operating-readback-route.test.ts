import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const { createRecordMutationsHoldReadbackResponse } = await import(
  '../app/api/admin/operating-readback/record-mutations-hold/readback-response'
);

const deploymentId = 'dpl_OperatingReadbackFixture123';
const commit = 'a'.repeat(40);

function runtimeEnvironment(hold = 'active') {
  return {
    ADMIN_RECORD_MUTATIONS_HOLD: hold,
    VERCEL: '1',
    VERCEL_DEPLOYMENT_ID: deploymentId,
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_REF: 'main',
    VERCEL_GIT_COMMIT_SHA: commit,
    VERCEL_PROJECT_ID: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
    VERCEL_TARGET_ENV: 'production',
  };
}

test('authenticates before reading runtime state and returns only deployment-bound hold facts', async () => {
  let authenticated = false;
  const accesses: string[] = [];
  const environment = new Proxy(runtimeEnvironment(), {
    get(target, property, receiver) {
      expect(authenticated).toBe(true);
      accesses.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  });
  const response = await createRecordMutationsHoldReadbackResponse({
    environment,
    requireAdminImpl: async () => {
      expect(accesses).toEqual([]);
      authenticated = true;
      return { ok: true, userId: 'admin-id-must-not-be-returned' };
    },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(await response.json()).toEqual({ commit, deploymentId, holdActive: true });
});

test('does not read runtime state for an unauthenticated request', async () => {
  const environment = new Proxy(runtimeEnvironment(), {
    get() { throw new Error('runtime state must remain unread'); },
  });
  const response = await createRecordMutationsHoldReadbackResponse({
    environment,
    requireAdminImpl: async () => ({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(await response.json()).toEqual({ code: 'OPERATING_READBACK_UNAUTHORIZED' });
});

test('reports the fail-closed hold boolean without returning its environment value', async () => {
  const secretMarker = 'unrecognized-hold-value-must-not-leak';
  const response = await createRecordMutationsHoldReadbackResponse({
    environment: runtimeEnvironment(secretMarker),
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
  });
  const body = await response.json();
  expect(body).toEqual({ commit, deploymentId, holdActive: true });
  expect(JSON.stringify(body)).not.toContain(secretMarker);
});

test('reports a cleared runtime hold as false for the collector to reject', async () => {
  const response = await createRecordMutationsHoldReadbackResponse({
    environment: runtimeEnvironment('cleared'),
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
  });
  expect(await response.json()).toEqual({ commit, deploymentId, holdActive: false });
});

test('returns one fixed error when deployment identity is absent or malformed', async () => {
  const secretMarker = 'runtime-diagnostic-must-not-leak';
  const response = await createRecordMutationsHoldReadbackResponse({
    environment: {
      ...runtimeEnvironment(),
      VERCEL_DEPLOYMENT_ID: secretMarker,
      VERCEL_GIT_COMMIT_SHA: secretMarker,
    },
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
  });
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body).toEqual({ code: 'OPERATING_READBACK_RUNTIME_UNAVAILABLE' });
  expect(JSON.stringify(body)).not.toContain(secretMarker);
});
