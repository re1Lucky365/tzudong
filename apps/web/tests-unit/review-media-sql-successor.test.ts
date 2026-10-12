import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileSuccessorPlan,
  loadSuccessorManifest,
  protectedSourceReadbackBinding,
  runReviewMediaSuccessor,
  validateSuccessorAdmission,
} from '../scripts/review-media-sql-successor.mjs';
import { elevenMigrationBundleSuffixRoot } from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const manifestBytes = readFileSync(new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const record = Object.freeze({
  bytes: manifestBytes,
  manifest,
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  materials: Object.freeze(manifest.migrations.map((migration: any) => ({
    path: migration.path,
    bytes: readFileSync(new URL(`../../../${migration.path}`, import.meta.url)),
    originalVector: migration.originalStatementVector,
  }))),
});
const executableRecord = Object.freeze({
  ...record,
  manifest: Object.freeze({
    ...record.manifest,
    launchPolicy: Object.freeze({ ...record.manifest.launchPolicy, state: 'ready' }),
  }),
});
const fixedNow = new Date('2026-10-12T08:00:00.000Z');
const revision = '056a86600f412eb42df4304e3206841679012f3e';
const databaseUrlFixture = new URL('postgresql://localhost/postgres');
databaseUrlFixture.hostname = 'aws-0-ap-southeast-1.pooler.supabase.com';
databaseUrlFixture.username = 'postgres.aqlcofblfxdrjhhdmarw';
databaseUrlFixture.port = '6543';
databaseUrlFixture.password = 'fixture-only';
const databaseUrl = databaseUrlFixture.toString();
const rollback = Object.freeze({
  deploymentId: 'dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5',
  deploymentSha: '1884f87e53c4567ead7c9a0fb394b09b91a70396',
  deploymentUrl: 'https://tzudong-fixture-twoimos-projects.vercel.app/',
  gitRef: 'main',
  productionAliases: ['tzudong.app', 'www.tzudong.app'],
  projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
  readyState: 'READY',
  repository: 'twoimo/tzudong',
  state: 'ready',
  target: 'production',
  teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
});
const directories: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value: any) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function stageStates() {
  const prefixRoot = '1'.repeat(64);
  return Array.from({ length: 12 }, (_, index) => ({
    bundle: {
      ledgerCount: 86 + index,
      prefixRoot,
      priorCount: 86,
      suffixRoot: index === 11 ? elevenMigrationBundleSuffixRoot(manifest.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      currentUser: 'postgres',
      databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? manifest.terminalContract.finishPreimageSha256
        : index === 11
          ? manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : (index + 2).toString(16).repeat(64),
      g014Root: (index < 3 ? 'a' : index === 3 ? 'b' : 'c').repeat(64),
      ledgerRoot: (index + 1).toString(16).repeat(64),
      ownerAuthorityReady: true,
      reviewItems: 0,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      schemaRoot: (index + 3).toString(16).repeat(64),
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: (index + 4).toString(16).repeat(64),
      terminalContractReady: index === 11,
    },
  }));
}

function admission() {
  const stages = stageStates();
  const writerFences = Object.fromEntries(Object.entries(manifest.requiredWriterFences).map(
    ([key, state], index) => [key, { evidenceSha256: (index + 8).toString(16).repeat(64), state }],
  ));
  return {
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-10-12T07:59:00.000Z',
    expiresAt: '2026-10-12T08:10:00.000Z',
    id: manifest.id,
    journalPathSha256: 'f'.repeat(64),
    manifestSha256: record.manifestSha256,
    projectRef: manifest.projectRef,
    protectedMainReceiptSha256: '1'.repeat(64),
    purpose: manifest.purpose,
    rehearsalReceiptSha256: '2'.repeat(64),
    rollback: { ...structuredClone(rollback), readbackSha256: '3'.repeat(64) },
    schemaVersion: 1,
    sourceReceiptSha256: '4'.repeat(64),
    sourceRevision: revision,
    sourceRoot: manifest.sourceRoot,
    stageStates: stages,
    writerFences,
  };
}

function custodyFiles(document = admission()) {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-review-successor-'));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const admissionPath = join(directory, 'admission.json');
  const journalPath = join(directory, 'attempt.jsonl');
  document.journalPathSha256 = sha256(journalPath);
  const common = {
    schemaVersion: 1,
    id: document.id,
    projectRef: document.projectRef,
    purpose: document.purpose,
    manifestSha256: document.manifestSha256,
    sourceRevision: document.sourceRevision,
    observedAt: document.createdAt,
    expiresAt: document.expiresAt,
  };
  const receipts: Record<string, any> = {
    'source-receipt.json': { ...common, kind: 'successor-source-receipt', sourceRoot: document.sourceRoot },
    'protected-main-receipt.json': {
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: manifest.protectedSource.ref,
      remote: manifest.protectedSource.remote,
      repositoryUrl: manifest.protectedSource.repositoryUrl,
      revision: document.sourceRevision,
    },
    'rehearsal-receipt.json': {
      ...common,
      kind: 'successor-rehearsal-receipt',
      passed: true,
      serverVersionNum: 170006,
      sourceRoot: document.sourceRoot,
      stageStatesSha256: sha256(JSON.stringify(canonical(document.stageStates))),
      suffixRoot: elevenMigrationBundleSuffixRoot(manifest.migrations),
    },
    'rollback-readback-receipt.json': {
      ...common,
      kind: 'rollback-readback-receipt',
      deploymentId: document.rollback.deploymentId,
      deploymentSha: document.rollback.deploymentSha,
      deploymentUrl: document.rollback.deploymentUrl,
      gitRef: document.rollback.gitRef,
      productionAliases: document.rollback.productionAliases,
      projectId: document.rollback.projectId,
      readyState: document.rollback.readyState,
      repository: document.rollback.repository,
      state: document.rollback.state,
      target: document.rollback.target,
      teamId: document.rollback.teamId,
    },
  };
  document.sourceReceiptSha256 = sha256(canonicalBytes(receipts['source-receipt.json']));
  document.protectedMainReceiptSha256 = sha256(canonicalBytes(receipts['protected-main-receipt.json']));
  document.rehearsalReceiptSha256 = sha256(canonicalBytes(receipts['rehearsal-receipt.json']));
  document.rollback.readbackSha256 = sha256(canonicalBytes(receipts['rollback-readback-receipt.json']));
  for (const [key, state] of Object.entries(manifest.requiredWriterFences)) {
    const name = `writer-fence-${key}.json`;
    receipts[name] = { ...common, fence: key, kind: 'writer-fence-readback-receipt', state };
    document.writerFences[key].evidenceSha256 = sha256(canonicalBytes(receipts[name]));
  }
  for (const [name, receipt] of Object.entries(receipts)) {
    const path = join(directory, name);
    writeFileSync(path, canonicalBytes(receipt), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  writeFileSync(admissionPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  chmodSync(admissionPath, 0o600);
  return { admissionPath, directory, document, journalPath };
}

function rollbackReadback(now = fixedNow) {
  return {
    schemaVersion: 1,
    kind: 'vercel-rollback-readback',
    projectId: rollback.projectId,
    teamId: rollback.teamId,
    deploymentId: rollback.deploymentId,
    deploymentUrl: rollback.deploymentUrl,
    readyState: rollback.readyState,
    target: rollback.target,
    repository: rollback.repository,
    gitSha: rollback.deploymentSha,
    gitRef: rollback.gitRef,
    productionAliases: [...rollback.productionAliases],
    observedAt: now.toISOString(),
  };
}

test('manifest binds the exact eleven sources and remains held without fresh admission', () => {
  const loaded = loadSuccessorManifest();
  expect(loaded.manifest.migrations).toHaveLength(11);
  expect(loaded.manifest.toolchain[0].path).toBe('apps/web/scripts/review-media-sql-successor.mjs');
  expect(loaded.manifest.operatingTransition).toEqual({ beforeEleven: 86, afterEleven: 97 });
  expect(loaded.manifest.launchPolicy.state).toBe('held');
  expect(loaded.manifest.sourceRoot).toBe('61f9d7637c0714a7b0d9108c6f7959ea820175a7870dba681498b570296a1544');
  expect(() => loadSuccessorManifest({ readVectorImpl: () => ['drift'] })).toThrow('SUCCESSOR_SOURCE_DRIFT');
});

test('compiled plan has one advisory lock, one outer transaction and eleven ledger writes', () => {
  const admitted = admission();
  const plan = compileSuccessorPlan(executableRecord, admitted);
  expect(plan.transactionMode).toBe('single-outer-transaction');
  expect(plan.sql.match(/pg_advisory_xact_lock\(7311754282260211::bigint\)/g)).toHaveLength(1);
  expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(statementSpans(plan.sql).some(span => /^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(span.token))).toBe(false);
  const lockTimeout = plan.sql.indexOf("SET LOCAL lock_timeout='2s'");
  const statementTimeout = plan.sql.indexOf("SET LOCAL statement_timeout='15s'");
  const advisoryLock = plan.sql.indexOf('pg_advisory_xact_lock(7311754282260211::bigint)');
  const expiryCheck = plan.sql.indexOf('SUCCESSOR_ADMISSION_EXPIRED');
  const firstMigration = plan.sql.indexOf('INSERT INTO supabase_migrations.schema_migrations');
  expect(lockTimeout).toBeGreaterThanOrEqual(0);
  expect(statementTimeout).toBeGreaterThan(lockTimeout);
  expect(advisoryLock).toBeGreaterThan(statementTimeout);
  expect(expiryCheck).toBeGreaterThan(advisoryLock);
  expect(firstMigration).toBeGreaterThan(expiryCheck);
  expect(plan.sql).toContain(`clock_timestamp() >= '${admitted.expiresAt}'::timestamptz`);
  expect(plan.stateQuery).toContain('terminalContractReady');
  expect(plan.stateQuery).toContain(manifest.terminalContract.finishPostimageSha256);
  expect(plan.stateQuery).toContain("c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,true)");
  expect(plan.stateQuery).toContain("unnest(coalesce(c.reloptions,'{}'))");
  expect(plan.stateQuery).toContain("unnest(coalesce(a.attacl,'{}'))");
  expect(plan.stateQuery).toContain('m.inherit_option,m.set_option');
  const storageState = plan.stateQuery.slice(
    plan.stateQuery.indexOf('storage_material AS'),
    plan.stateQuery.indexOf('contract AS'),
  );
  expect(storageState).toContain('lifecycle_configuration_generation');
  expect(storageState).not.toContain('created_at');
  expect(storageState).not.toContain('updated_at');
});

test('admission rejects wrong preimage and every wrong writer fence', () => {
  {
    const files = custodyFiles();
    files.document.stageStates[10].state.finishCleanupBodySha256 = '0'.repeat(64);
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  {
    const files = custodyFiles();
    files.document.stageStates[0].state.ownerAuthorityReady = false;
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
  for (const key of Object.keys(manifest.requiredWriterFences)) {
    const files = custodyFiles();
    files.document.writerFences[key].state = 'wrong';
    expect(() => validateSuccessorAdmission(files.document, executableRecord, {
      now: fixedNow,
      receiptDirectory: files.directory,
    })).toThrow('SUCCESSOR_ADMISSION_INVALID');
  }
});

test('success path performs preflight, rechecks rollback and commits all eleven once', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const calls: string[] = [];
  let rollbackReads = 0;
  const result = runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => { rollbackReads += 1; return rollbackReadback(); },
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      return JSON.stringify(calls.length === 1 ? plan.priorReadback.expected : plan.finalReadback.expected);
    },
  });
  expect(result).toMatchObject({ code: 'SUCCESSOR_COMMITTED', status: 'committed' });
  expect(rollbackReads).toBe(2);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(readFileSync(files.journalPath, 'utf8')).toContain('SUCCESSOR_COMMITTED');
});

test('concurrent rollback deployment change rejects before journal or mutation', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  let rollbackReads = 0;
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => {
      rollbackReads += 1;
      return rollbackReads === 1 ? rollbackReadback() : { ...rollbackReadback(), gitSha: '0'.repeat(40) };
    },
    runPsqlImpl: (_url, sql) => { calls.push(sql); return JSON.stringify(plan.priorReadback.expected); },
  })).toThrow('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  expect(rollbackReads).toBe(2);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
});

test('prior readback mismatch fails before journal and mutating transport', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const mismatch = structuredClone(plan.priorReadback.expected);
  mismatch.bundle.ledgerCount += 1;
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: (_url, sql) => { calls.push(sql); return JSON.stringify(mismatch); },
  })).toThrow('SUCCESSOR_PREFLIGHT_MISMATCH');
  expect(calls).toHaveLength(1);
  expect(calls[0]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(() => readFileSync(files.journalPath)).toThrow();
});

test('lost apply acknowledgement reconciles once and never resends eleven mutations', () => {
  const files = custodyFiles();
  const plan = compileSuccessorPlan(executableRecord, files.document);
  const calls: string[] = [];
  expect(() => runReviewMediaSuccessor({
    admissionPath: files.admissionPath,
    journalPath: files.journalPath,
    environment: { SUPABASE_DB_URL: databaseUrl },
  }, {
    now: () => fixedNow,
    gitFactsImpl: () => ({ clean: true, detached: true, revision }),
    loadManifestImpl: () => executableRecord,
    protectedMainReadbackImpl: () => protectedSourceReadbackBinding(manifest, revision),
    rollbackReadbackImpl: () => rollbackReadback(),
    runPsqlImpl: (_url, sql) => {
      calls.push(sql);
      if (calls.length === 1) return JSON.stringify(plan.priorReadback.expected);
      if (calls.length === 2) throw new Error('lost acknowledgement');
      return JSON.stringify(plan.finalReadback.expected);
    },
  })).toThrow('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(3);
  expect(calls[1].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(calls[2]).not.toMatch(/^INSERT INTO supabase_migrations\.schema_migrations/gm);
  expect(readFileSync(files.journalPath, 'utf8')).toContain('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
});
