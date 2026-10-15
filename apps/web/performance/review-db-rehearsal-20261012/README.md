# Review-media successor rollback rehearsal

The held eleven-migration controller now has a separate rollback-only rehearsal
and durable publication protocol. Operating application remains unperformed.

## Behavior and failure boundaries

- The rehearsal admission binds the clean detached protected-main source,
  rollback identity, seven writer fences, private paths and exact statement vectors.
- The eleven vectors run once in one explicit transaction. State 0 through 11
  is captured before ROLLBACK, and a separate read-only transaction must match
  state 0. Transport failure triggers readback only, never a repeated mutation.
- The pending receipt is exclusively created and fsynced; the verification
  journal entry is fsynced before the canonical hard link is created. The custody
  directory is fsynced before publication confirmation is appended.
- Publication audit fsync failure cannot reconcile from visible bytes. Only a
  close acknowledgement failure after successful fsync permits exact-byte
  reconciliation. Apply separately validates and fsyncs the exact admitted
  receipt and three-entry journal plus their custody directory. Thus an earlier
  unconfirmed fsync cannot be silently treated as durable by a later process.
- Apply writes and fsyncs its own start journal and parent directory before any
  mutating transport. Five injected failures across receipt, rehearsal journal,
  custody directory, start journal and start directory produced zero mutations.
- A failed terminal audit preserves its bounded operation code alongside the
  journal failure. Arbitrary diagnostics and throwing getters cannot escape the
  bounded failure JSON.
- Both SQL paths check expiry after acquiring the advisory lock. Apply arms
  PostgreSQL 17 transaction_timeout against the original absolute deadline and
  checks after each migration and after the final readback, before COMMIT. The
  receipt timestamps use the original admitted window rather than a 30-second
  execution limit; 30 seconds remains only a current-clock skew allowance.

## Current verification

Pinned Node 24 and Bun 1.4.0 verified six affected suites across targeted runs: **94 passed, 0 failed,
518 assertions**. The checks include publication fsync/close failures, five
pre-mutation durability failures, expiry plus audit failure, tampered/orphan
journals, retained evidence, private admission formatting, database/role ownership
and lost acknowledgements. Filesystem expiry is rechecked before verification,
publication, and successful return. A committed database outcome survives terminal
audit failure; only proven durability plus exact journal bytes permits reconciliation.
Targeted ESLint and Node syntax checks passed.

The final source was replayed once in an isolated Supabase PostgreSQL 17.6
container. It compiled and executed eleven immutable migrations (112 source
statements), captured twelve states, and verified exact restoration after normal
rollback, forced SQL failure, a discarded response and contended expiry. The
lost-response case attempted the mutation once. The owned container was removed.
This database replay exercises the SQL compiler and SQL behavior; filesystem
controller failures are covered by the separate fault-injection tests above.

The source fixture is local `ranking_clone`, copied with its contract seed rows.
The verifier explicitly checks `public.profiles` and `public.reviews` are empty;
it does not claim a universal personal-data census. Its synthetic ledger has 86
entries, not an operating ledger readback.

- Current proof (selector-bound): `pg17-reviewed-boundaries-20261013.json`
- Proof SHA-256: `9c73b47c0841f2585d7ceee77423d27410a488e61080004cf227d4329dd88076`
- Manifest SHA-256: `23bf7e7d7e9e5d7962021dd3ec860e87b47d07e119ba0e39de2e423a0a601f4e`
- Toolchain root: `579f315ba6285ea7ccc562cf2cf8949203a0a3289e4de5f82be1687ddea4170b`
- Source root: `61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544`
- Verifier SHA-256: `f7321f607a5bf3a24ba099d51abc67254db52fcc385945692426d1b2dfa6e431`
- Compiled SQL SHA-256: `285d0c859117006646389dbd2a22de9aef1c0b97bc796a9e4d4448a8a232b093`

## Reproduce without overwriting evidence

From the repository root:

```sh
/opt/homebrew/opt/node@24/bin/node \
  apps/web/performance/review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs
```

The stable `retained-current-proof.json` selector declares the current retained
proof. The detached map digest, selector, every mapped artifact and selected proof
are verified from the same byte snapshots; mismatched source bindings are reported
as historical. Each execution prints a current proof to stdout. Optional
`--output /absolute/new-proof.json` creates a separate private file exclusively;
it refuses any existing output. The verifier does not delete the source
container or a fixed-name container: creation and cleanup require a unique name,
per-run owner label and exact inspected container ID. Lost create/delete
acknowledgements are reconciled by ownership/absence readback.

`pg17-rollback-rehearsal.json` and `SHA256SUMS-pre-hardening-historical` preserve
the earlier pre-hardening evidence. `pg17-rollback-rehearsal-current-20261013.json`
is the intermediate replay before the safe-getter fix. Neither is labelled as
final-source proof. The original `performance/review-db-successor-20261012/`
README, retained proof and SHA256SUMS remain unchanged.

## Limits and next operating step

Launch policy remains held. No hosted DDL, operating row read, Storage mutation,
deployment, cost reduction or performance improvement is established here.
Operating execution needs current protected main, fresh actual-ledger rehearsal,
source/rollback and writer-fence receipts, private admission and a new journal.
Storage projections exclude timestamps and cannot distinguish recreation of an
otherwise identical bucket. The retained evidence and source hashes are in
`SHA256SUMS`; raw SQL, credentials and operating rows are absent from the proof.

The earlier `pg17-rollback-rehearsal-final-20261013.json` remains immutable
historical evidence for the earlier durability implementation.
`interrupted-attempt-20261013.json` records a stopped attempt without a result;
its exact owned container was removed after the process was confirmed absent.
It is not counted as a successful replay.

Private admission formatting does not authenticate observation origin. The
operating capture adapter, fresh writer-fence evidence, protected promotion,
hosted application and live user flows remain separate unfinished steps.

The reviewed replay additionally reached the actual eleven-stage apply terminal
readback, injected an expired timestamp in only the final wrapper guard, observed
SUCCESSOR_ADMISSION_EXPIRED and confirmed exact baseline restoration from a separate
read-only connection. This explicitly labelled fault injection proves the final
guard/rollback path; it does not measure an actual fifteen-minute operating lease.
The original migration statements and statement vectors remain unchanged.
# Review-fix verification — 2026-10-14

The current selector now points to `pg17-review-fixes-20261014-v1.json`.
It binds the changed successor manifest and the unchanged rollback harness.
Twelve stage readbacks, exact rollback, forced failure, lost acknowledgement
with one mutation attempt, real contended expiry, and apply-final deadline
rejection passed on isolated PostgreSQL 17.6. The owned container was removed.
No hosted rows or operating changes were involved.

The first PR3202 Ubuntu npm full suite correctly rejected stale dependency
hashes in this directory's complete artifact map. Its bounded failure receipt
and the old map, pin and selector are retained. The current map binds current
source bytes while historical proofs remain historical; the new selector is
backed by a fresh replay, not by relabelling an older proof.
