import { expect, test } from 'bun:test';

import {
  StoryboardRuntimeObserverError,
  expectedCompatibilityFromBundle,
  fetchLiveStoryboardCompatibility,
  observeStoryboardRuntimeCompatibility,
  validateProductionCompatibilityUrl,
} from '../scripts/observe-storyboard-runtime-compatibility.mjs';

const url = 'https://www.tzudong.app/api/runtime-compatibility/storyboard';
const deploymentId = 'dpl_RuntimeObserverFixture123';
const commit = 'd'.repeat(40);
const policySha256 = 'e'.repeat(64);
const bundleSha256 = 'f'.repeat(64);

function bundle() {
  return {
    schemaVersion: 1,
    kind: 'review-media-successor-vercel-operating-bundle',
    adminRecordMutationsHold: { deploymentId, commit, holdActive: true, observedAt: '2026-10-14T00:00:00Z' },
    storyboardPolicy: {
      schemaVersion: 1,
      deployment: { branch: 'main', deploymentId, projectId: 'fixture-project', sourceCommit: commit },
      policy: { canonicalPolicySha256: policySha256 },
    },
  };
}

function live(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility',
    deploymentId,
    commit,
    canonicalPolicySha256: policySha256,
    ...overrides,
  };
}

function response(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function code(error: unknown) {
  expect(error).toBeInstanceOf(StoryboardRuntimeObserverError);
  return (error as StoryboardRuntimeObserverError).code;
}

test('accepts only the exact HTTPS production aliases and fixed endpoint path', () => {
  expect(validateProductionCompatibilityUrl(url).hostname).toBe('www.tzudong.app');
  for (const invalid of [
    'http://www.tzudong.app/api/runtime-compatibility/storyboard',
    'https://preview.vercel.app/api/runtime-compatibility/storyboard',
    'https://www.tzudong.app/api/runtime-compatibility/storyboard?token=secret',
    'https://user:pass@www.tzudong.app/api/runtime-compatibility/storyboard',
    'https://www.tzudong.app/api/runtime-compatibility/storyboard/extra',
  ]) {
    expect(() => validateProductionCompatibilityUrl(invalid)).toThrow('STORYBOARD_RUNTIME_OBSERVER_URL_INVALID');
  }
});

test('compares live deployment, commit, and policy without inventing time or readiness evidence', async () => {
  let options: RequestInit | undefined;
  const observation = await observeStoryboardRuntimeCompatibility({
    bundle: bundle(),
    bundleSha256,
    url,
    fetchImpl: async (_target: URL | RequestInfo, init?: RequestInit) => {
      options = init;
      return response(live());
    },
  });
  expect(options?.redirect).toBe('error');
  expect(options?.cache).toBe('no-store');
  expect(observation).toEqual({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-observation',
    productionAlias: 'www.tzudong.app',
    bundleSha256,
    deploymentId,
    commit,
    canonicalPolicySha256: policySha256,
  });
  expect(JSON.stringify(observation)).not.toMatch(/observed|ready|provider|database/i);
});

test('rejects redirects instead of following an alias or authentication destination', async () => {
  await expect(fetchLiveStoryboardCompatibility({
    url,
    fetchImpl: async () => response({}, { status: 302, headers: { location: 'https://attacker.invalid/' } }),
  })).rejects.toThrow('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
});

test('rejects declared and streamed oversized responses', async () => {
  await expect(fetchLiveStoryboardCompatibility({
    url,
    fetchImpl: async () => response(live(), { headers: { 'content-length': '2049' } }),
  })).rejects.toThrow('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');

  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2049));
      controller.close();
    },
  });
  await expect(fetchLiveStoryboardCompatibility({
    url,
    fetchImpl: async () => new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } }),
  })).rejects.toThrow('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
});

test('distinguishes deployment identity mismatch from policy mismatch', async () => {
  try {
    await observeStoryboardRuntimeCompatibility({
      bundle: bundle(), bundleSha256, url,
      fetchImpl: async () => response(live({ commit: 'a'.repeat(40) })),
    });
    throw new Error('expected identity mismatch');
  } catch (error) {
    expect(code(error)).toBe('STORYBOARD_RUNTIME_OBSERVER_IDENTITY_MISMATCH');
  }

  try {
    await observeStoryboardRuntimeCompatibility({
      bundle: bundle(), bundleSha256, url,
      fetchImpl: async () => response(live({ canonicalPolicySha256: 'a'.repeat(64) })),
    });
    throw new Error('expected policy mismatch');
  } catch (error) {
    expect(code(error)).toBe('STORYBOARD_RUNTIME_OBSERVER_POLICY_MISMATCH');
  }
});

test('times out a stalled read without retrying or exposing transport diagnostics', async () => {
  let calls = 0;
  await expect(fetchLiveStoryboardCompatibility({
    url,
    timeoutMs: 5,
    fetchImpl: async (_target: URL | RequestInfo, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    },
  })).rejects.toThrow('STORYBOARD_RUNTIME_OBSERVER_FETCH_FAILED');
  expect(calls).toBe(1);
});

test('requires a bundle-bound private policy readback instead of accepting the historical bundle alone', () => {
  const missing = bundle() as any;
  delete missing.storyboardPolicy;
  expect(() => expectedCompatibilityFromBundle(missing)).toThrow('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');

  const drift = bundle() as any;
  drift.storyboardPolicy.deployment.sourceCommit = 'a'.repeat(40);
  expect(() => expectedCompatibilityFromBundle(drift)).toThrow('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
});
