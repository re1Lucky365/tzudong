# Sentry release identity correction · 2026-10-15

An actual protected Vercel preview successfully ingested a synthetic browser error, but its stored release did not identify the deployment Git SHA. `sentry-preview-20261015-v1/preview-correlation-v1.json` preserves that failure. Environment was correctly `preview`; receipt alone was insufficient for source-version correlation.

The existing Next env object now embeds a validated full build commit under `NEXT_PUBLIC_SENTRY_RELEASE`. Browser, Node and Edge initialization use that immutable build identity, and the Sentry build plugin receives the same name. Package/account labels, abbreviated/invalid commits, and free-form values are refused. No runtime token, user identity, tracing, replay, source scraping, or billing change is introduced. The issue-read token remains event:read only and is not reused for source maps.

Validation includes the actual composed Next config (to catch env object overwrites), source identity crossing the existing event privacy filter, malformed identities, related SDK/image boundary tests, lint, compiler parity, production build/CSS, and exact preview event/source readback. Passing local checks is separate from deployed release binding.
