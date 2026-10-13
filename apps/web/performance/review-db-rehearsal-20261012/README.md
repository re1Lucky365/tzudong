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

Pinned Node 24 and Bun 1.4.0 ran four affected suites: **53 passed, 0 failed,
284 assertions**. The checks include publication fsync/close failures, five
pre-mutation durability failures, expiry plus audit failure, tampered/orphan
journals, retained evidence, unique container ownership and lost acknowledgements.
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

- Current proof: `pg17-rollback-rehearsal-final-20261013.json`
- Proof SHA-256: `7f74c175be3eee72b5e93eb75dac07bfefc0ef88d7d9957c26d877ee125ff590`
- Manifest SHA-256: `8297b18793513956118c720e3aa5bd481d0769645c263f680a5272825b70569e`
- Toolchain root: `91a7166b76b0f867b4e74dd0e2258d1f22457c75a61e55b161148378f08ac739`
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
