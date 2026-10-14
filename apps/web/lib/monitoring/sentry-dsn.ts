export function validSentryDsn(value: string | undefined): string | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.password || url.port || url.search || url.hash
      || !/^[a-f0-9]{16,64}$/i.test(url.username) || !/^\/\d+$/.test(url.pathname)
      || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return undefined;
    return value;
  } catch { return undefined; }
}

/** CSP grants exactly one public Sentry Cloud ingestion origin, never the DSN key or a wildcard. */
export function sentryIngestionOrigin(value: string | undefined): string | null {
  const dsn = validSentryDsn(value);
  if (!dsn) return null;
  const url = new URL(dsn);
  return /^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/.test(url.hostname) ? url.origin : null;
}
