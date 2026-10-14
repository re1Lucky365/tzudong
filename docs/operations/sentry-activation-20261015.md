# Sentry activation · 2026-10-15

The existing SDK 11.4.0 integration is reused for the `tinyburn-data-lab` organization and its new `tzudong` Next.js project (4512255864864768, US region). Aside session `496eGBI4iHvc9n7L` supplied the organization context; live Sentry and Vercel state were checked separately. Billing shows a trial and no payment method. No checkout, paid plan, automatic email alert, replay, tracing, profiling, logs, or billing change was enabled.

The production CSP omitted the configured ingestion endpoint. A regression test failed before this patch. CSP now admits exactly the valid configured Sentry Cloud ingestion origin, with no wildcard or DSN key. Unknown hosts fail closed. SDK privacy filters, error-only integrations, disabled categories, and administrator authorization remain in place; `sendDefaultPii: false` is explicit. DSN parsing is a small shared module without an SDK runtime import in the proxy.

The actual Vercel project was checked: `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`, team `twoimos-projects`, repository `twoimo/tzudong`, root `apps/web`, main production branch. Seven Sentry variables were added for production and preview through CLI stdin; the issue token is server-only and has only `event:read`. Upload credentials are not reused from this token. Source maps are not uploaded without a separate CI token. Secret values stay outside Git and evidence.

Local checks: related CSP/privacy/SDK tests, isolated admin feed/authorization tests, targeted ESLint, native/compat TypeScript parity, and Next.js production build with named-dist route CSS validation. Live event transport, administrator readback, protected promotion, and exact deployed source must be independently recorded before claiming operating activation.

Evidence is retained under `apps/web/performance/sentry-activation-20261015-v1`. The prior observed production rollback is `1884f87e53c4567ead7c9a0fb394b09b91a70396` at deployment `dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5`; repeat the current deployment readback before release. Existing independent SQL/media/memory/field work is not certified by this Sentry change.
