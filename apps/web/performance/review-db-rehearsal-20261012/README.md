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
- Both SQL paths check expiry after acquiring the advisory lock. Rehearsal also
  checks before each migration; apply checks once after the lock. These are not
  claims that all eleven migrations finish before the admission expiry.

## Current verification

Pinned Node 24 and Bun 1.4.0 ran five affected suites: **81 passed, 0 failed,
450 assertions**. The checks include publication fsync/close failures, five
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

- Current proof: `pg17-terminal-boundaries-20261013.json`
- Proof SHA-256: `0cfc9c10ff7b70c606f6eeef33fff8dbd14636dc15b7c963925097454ee454a2`
- Manifest SHA-256: `ae764bb760102a6d7d066be669c85248feed1823eafded4bf8c246a062090a8c`
- Toolchain root: `a0eeeb623c80b8a5e416b84397bdb07e4bd65c670d98b70707cc816d37e9a18b`
- Source root: `61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544`
- Verifier SHA-256: `8088aa57f39045e2bf93cba084711119395098d053318b70aaa676b5c13fea26`
- Compiled SQL SHA-256: `285d0c859117006646389dbd2a22de9aef1c0b97bc796a9e4d4448a8a232b093`

## Reproduce without overwriting evidence

From the repository root:

```sh
/opt/homebrew/opt/node@24/bin/node \
  apps/web/performance/review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs
```

The existing proof is checksum-verified and reported as historical when its
bindings differ. Each execution prints a current proof to stdout. Optional
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
