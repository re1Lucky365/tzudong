import { describe, expect, test } from 'bun:test';
import { sentryIngestionOrigin } from '../lib/monitoring/sentry-dsn';

const key = 'a'.repeat(32);
describe('Sentry CSP ingestion boundary', () => {
  test('grants the precise configured Cloud region without disclosing ingestion credentials', () => {
    for (const host of ['o1.ingest.sentry.io', 'o123.ingest.us.sentry.io', 'o456.ingest.de.sentry.io']) {
      const origin = sentryIngestionOrigin(`https://${key}@${host}/123`);
      expect(origin).toBe(`https://${host}`);
      expect(origin).not.toContain(key);
    }
  });
  test('refuses missing, forged, broad, encoded, or credential-bearing sources', () => {
    for (const value of [undefined, '', `https://${key}@ingest.us.sentry.io/123`,
      `https://${key}@o1.ingest.us.sentry.io.evil.test/123`, `https://${key}@*.sentry.io/123`,
      `https://${key}@evil.test/123`, `http://${key}@o1.ingest.sentry.io/123`,
      `https://${key}:secret@o1.ingest.sentry.io/123`, `https://${key}@o1.ingest.sentry.io:443/123?key=x`,
      `https://${key}@o1.ingest.sentry.io/123#x`, `https://${key}@o1.ingest.sentry.io/not-a-project`,
      `https://${key}@o1.ingest.eu.sentry.io/123`]) expect(sentryIngestionOrigin(value)).toBeNull();
  });
});
