# Review media SQL successor: local PG17 evidence

This directory contains local-only evidence for the held 11-stage review-media
successor. It does not authorize or prove a hosted database write.

The retained pre-hardening replay cloned the schema-only `ranking_clone`
template into a fixed database and checked zero profiles and zero reviews.
Current code uses a process-specific database name with a 128-bit random suffix.
It preserves a pre-create absence baseline and verifies exact owner/template
metadata before cleanup, including lost CREATE acknowledgement and first readback. Six already-applied predecessor sources reconstruct
the relevant pre-state; 86 synthetic ledger rows model the observed predecessor
cardinality without claiming hosted parity. This harness does not read or prove
the hosted ledger. A hosted attempt must freshly confirm that the actual ledger
is still exactly 86 and capture all 12 hosted stage states inside the admitted
window; this local proof cannot be reused as that rehearsal receipt.

Run with Node 24:

```sh
/opt/homebrew/opt/node@24/bin/node \
  apps/web/performance/review-db-successor-20261012/verify-review-media-sql-successor.mjs
```

The retained historical proof records 11 migrations, 112 source statements, exact stage
roots, ledger transition 86 to 97, atomic success, forced-failure rollback,
wrong `finish_review_media_cleanup` preimage rejection, post-lock admission
expiry rejection under real advisory-lock contention, and independent catalog
drift rejection for view `security_invoker`, column ACLs, and PostgreSQL 17 role
membership options. Every rejection preserves the pre-apply database state, and
the temporary database and local fixture roles are removed before proof output.
The compiled transaction is 6,492,122 bytes. Two complete runs produced the
same proof SHA-256, `6f5dc5c5603c8a4d8b601d3edb28009e454e955292a65707747e66f274557b3f`.

The Storage root deliberately excludes bucket creation and update timestamps so
the same security and behavior configuration has a stable digest across an
independent replay. It still binds the bucket identity, visibility, ownership,
limits, MIME types, type, versioning, and lifecycle fields. Therefore this proof
does **not** establish preservation of timestamp-only changes or distinguish a
bucket that was deleted and recreated with identical included settings.

The production manifest remains `held`. Hosted execution still requires a
protected-main source receipt, fresh 12-state rehearsal receipt, current Vercel
rollback readback, all seven writer-fence receipts, a private admission file,
and a new journal path.

## Current ownership verification

`verify-fixture-ownership.mjs` creates a separate labelled PostgreSQL 17.6
container and exercises six real ownership scenarios: normal role/database
creation, lost creation acknowledgement, lost first readback, and lost role
deletion acknowledgement. Each scenario attempts CREATE once and confirms
cleanup. Database predecessor/fixture application is deliberately excluded from
this ownership check; the separate rollback verifier covers SQL execution.

Use `--output /absolute/new-proof.json` to reproduce without overwriting any
retained evidence. The verifier refuses existing output before creating a
container and removes only its exact per-run labelled container.

The first startup attempt used Unix socket readiness too early. Another attempt
expected the injected error instead of the harness bounded error. Their failure
records and the interpretation are retained; neither establishes a production
failure or performance result. Official role privilege semantics are described
in [PostgreSQL 17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html).

Current ownership proof: `pg17-fixture-ownership-current-20261013.json`
(SHA-256 `0e7f96493ba9ad63959fa25c775fb6e95d0616d47fa4bdae973e248f5eab0349`).
The earlier `pg17-fixture-ownership-20261013.json` is retained for the verifier
before optional exclusive output support. Both establish six isolated scenarios;
the current proof matches the current helper and verifier bytes.

## Reviewed helper binding — 2026-10-13

Current ownership evidence is `pg17-fixture-ownership-reviewed-20261013.json`.
It binds the fixture helper, this ownership verifier and the imported rollback
container helper. All three source byte hashes are checked before/after the run,
including cleanup. Six scenarios again recorded one CREATE and one confirmed
cleanup each. Earlier proofs remain immutable historical evidence.

The forward fixture harness now sends the full SQL once. A failed acknowledgement
is reconciled only by an exact read-only baseline/terminal-state read; it never
performs a diagnostic mutation replay. Two injected outcome cases cover terminal
commit acknowledgement loss and a rolled-back baseline. This change has local
fault tests; no fresh forward-harness replay is claimed.

## Current review-fix replay — 2026-10-14

`pg17-current-review-fixes-20261014-v2.json` binds the current manifest and harness.
It passed the 11-stage PG17.6 atomic commit, exact rollback, wrong preimage,
view/column ACL/membership drift, and real advisory-wait expiry rejection. The
per-run database and fixture roles were removed. The template still records
1,963 manifest rows and zero profiles/reviews; no hosted state was accessed.

The v1 attempt failed to observe contention in its 700ms observation window.
Its stdout and stderr are retained. The local fixture now confirms the holder
is ready before starting the same 1.5-second expiry window, observes an actual
wait before expiry, and releases the lock just after expiry. Production timeouts
are unchanged; this is a fixture-order correction, not a performance result.
The historical proof and old checksum indexes remain available. The current
retained-proof reader verifies the independently pinned checksum map before
accepting any entry and still classifies old source bindings as historical.
