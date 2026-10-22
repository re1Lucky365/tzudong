import * as Sentry from '@sentry/nextjs';
import { sentryBuildRelease } from '@/lib/monitoring/sentry-release';
import { sentryPrivacyOptions, validSentryDsn } from '@/lib/monitoring/sentry-privacy';

const dsn = validSentryDsn(process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  Sentry.init({ ...sentryPrivacyOptions, dsn, release: sentryBuildRelease(process.env.NEXT_PUBLIC_SENTRY_RELEASE), environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV });
}
