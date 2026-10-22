import { describe, expect, test } from 'bun:test';

import {
  privacyApiMutationStatus,
  privacyFixture,
  privacyFixtureScenarios,
  privacyScenarioCookies,
  privacyScenarioFromCookie,
  privacyScenarioFromPathname,
  privacyScenarioPlan,
  privacyScenarioStepFromCookie,
  withoutPrivacyFixtureCookies,
} from '../performance/admin-route-consistency-20261012/v2/fixture-server.mjs';

describe('privacy fixture scenarios', () => {
  test('retains the original default three-record and two-risk fixture', () => {
    const plan = privacyScenarioPlan('default');
    expect(plan).toEqual({ status: 200, body: privacyFixture, delayMs: 0, nextStep: null });
    expect(privacyFixture.incidents).toHaveLength(3);
    expect(privacyFixture.incidents.filter((incident) => ['overdue', 'due_soon'].includes(incident.deadlineStatus)))
      .toHaveLength(2);
  });

  test('defines four deterministic bounded UI-state scenarios', () => {
    expect(privacyFixtureScenarios).toEqual([
      'default',
      'initial-failure',
      'successful-empty',
      'delayed-success',
      'success-then-refresh-failure',
    ]);
    expect(privacyScenarioPlan('initial-failure')).toMatchObject({
      status: 503, delayMs: 0, nextStep: null, body: { ok: false, error: 'PRIVACY_FIXTURE_INITIAL_FAILURE' },
    });
    expect(privacyScenarioPlan('successful-empty')).toMatchObject({
      status: 200, delayMs: 0, nextStep: null,
      body: { ok: true, incidents: [], notices: [], actions: [] },
    });
    expect(privacyScenarioPlan('delayed-success')).toEqual({
      status: 200, body: privacyFixture, delayMs: 800, nextStep: null,
    });
    expect(privacyScenarioPlan('success-then-refresh-failure', 0)).toEqual({
      status: 200, body: privacyFixture, delayMs: 0, nextStep: 1,
    });
    expect(privacyScenarioPlan('success-then-refresh-failure', 1)).toMatchObject({
      status: 503, delayMs: 0, nextStep: 1,
      body: { ok: false, error: 'PRIVACY_FIXTURE_REFRESH_FAILURE' },
    });
  });

  test('selects scenarios with private bounded cookies and resets each entry to step zero', () => {
    const cookies = privacyScenarioCookies('success-then-refresh-failure');
    expect(cookies).toHaveLength(2);
    expect(cookies.every((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes('SameSite=Strict'))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes('Max-Age=900'))).toBe(true);
    const header = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    expect(privacyScenarioFromCookie(header)).toBe('success-then-refresh-failure');
    expect(privacyScenarioStepFromCookie(header)).toBe(0);
    expect(() => privacyScenarioCookies('../escape')).toThrow('FIXTURE_SCENARIO_INVALID');
    expect(privacyScenarioFromCookie('tzudong_fixture_privacy_scenario=unknown')).toBe('default');
    expect(privacyScenarioFromPathname('/__fixture/scenario/delayed-success')).toBe('delayed-success');
    expect(privacyScenarioFromPathname('/__fixture/scenario/unknown')).toBeNull();
    expect(privacyScenarioFromPathname('/__fixture/scenario/../default')).toBeNull();
  });

  test('keeps the fixture API read-only', () => {
    expect(privacyApiMutationStatus('GET')).toBeNull();
    expect(privacyApiMutationStatus('HEAD')).toBeNull();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(privacyApiMutationStatus(method)).toBe(403);
    }
  });

  test('does not forward fixture-control cookies to the application', () => {
    const input = [
      'sb-127-auth-token=synthetic-session',
      'tzudong_fixture_privacy_scenario=delayed-success',
      'tzudong_fixture_privacy_step=1',
      'application-preference=compact',
    ].join('; ');
    expect(withoutPrivacyFixtureCookies(input)).toBe(
      'sb-127-auth-token=synthetic-session; application-preference=compact',
    );
    expect(withoutPrivacyFixtureCookies(
      'tzudong_fixture_privacy_scenario=default; tzudong_fixture_privacy_step=0',
    )).toBeNull();
  });
});
