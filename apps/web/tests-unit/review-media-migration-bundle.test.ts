import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  bundleReconciliationOutcome,
  compileElevenMigrationBundle,
  compileElevenMigrationRehearsalSources,
  elevenMigrationBundleSuffixRoot,
  executeMigrationBundle,
} from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const manifest = JSON.parse(readFileSync(
  new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url),
  'utf8',
));

function fixture() {
  const prefixRoot = 'a'.repeat(64);
  const priorCount = 86;
  const materials = manifest.migrations.map((migration: any) => ({
    path: migration.path,
    bytes: readFileSync(new URL(`../../../${migration.path}`, import.meta.url)),
    originalVector: migration.originalStatementVector,
  }));
  const migrations = manifest.migrations.map((migration: any, index: number) => ({
    id: migration.id,
    path: migration.path,
    sha256: migration.sha256,
    statementVectorSha256: migration.statementVectorSha256,
    expectedPriorState: {
      query: "SELECT '{\"fixture\":true}'::text AS state",
      expected: { fixture: true, stage: index },
    },
    terminalReadback: {
      query: "SELECT '{\"fixture\":true}'::text AS state",
      expected: { fixture: true, stage: index + 1 },
    },
  }));
  const suffixRoot = elevenMigrationBundleSuffixRoot(migrations);
  const query = "SELECT '{\"fixture\":true}'::text AS state";
  const priorReadback = {
    query,
    expected: { bundle: { ledgerCount: 86, prefixRoot, priorCount, suffixRoot: null, targetCount: 0 } },
  };
  const finalReadback = {
    query,
    expected: { bundle: { ledgerCount: 97, prefixRoot, priorCount, suffixRoot, targetCount: 11 } },
  };
  migrations[0].expectedPriorState = priorReadback;
  return {
    bundle: {
      schemaVersion: 1,
      id: 'review_media_sql_successor_v1',
      priorCount,
      prefixRoot,
      suffixRoot,
      migrations,
      priorReadback,
      finalReadback,
    },
    materials,
  };
}

test('all eleven exact sources compile into one outer transaction', () => {
  const input = fixture();
  const compiled = compileElevenMigrationBundle(input.bundle, input.materials);
  const spans = statementSpans(compiled.sql);
  expect(compiled.transactionMode).toBe('single-outer-transaction');
  expect(compiled.plans).toHaveLength(11);
  expect(compiled.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(spans.filter(span => /^SELECT\b/i.test(span.token))).toHaveLength(1);
  expect(spans.some(span => /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(span.token))).toBe(false);
  expect(spans.at(-1)?.token).toStartWith("SELECT '{\"fixture\":true}'");
});

test('eleven-stage compiler rejects source, vector, order and cardinality drift before transport', () => {
  {
    const input = fixture();
    input.materials[0].bytes = Buffer.concat([input.materials[0].bytes, Buffer.from(' ')]);
    expect(() => compileElevenMigrationBundle(input.bundle, input.materials)).toThrow('MIGRATION_FILE_DIGEST_MISMATCH');
  }
  {
    const input = fixture();
    input.materials[0].originalVector = [...input.materials[0].originalVector, 'SELECT 1'];
    expect(() => compileElevenMigrationBundle(input.bundle, input.materials)).toThrow('MIGRATION_VECTOR_MISMATCH');
  }
  {
    const input = fixture();
    [input.bundle.migrations[0], input.bundle.migrations[1]] = [input.bundle.migrations[1], input.bundle.migrations[0]];
    [input.materials[0], input.materials[1]] = [input.materials[1], input.materials[0]];
    expect(() => compileElevenMigrationBundle(input.bundle, input.materials)).toThrow('ORDER_OR_IDENTITY_INVALID');
  }
  {
    const input = fixture();
    input.bundle.migrations.pop();
    input.materials.pop();
    expect(() => compileElevenMigrationBundle(input.bundle, input.materials)).toThrow('MIGRATION_BUNDLE_INVALID');
  }
});

test('rollback-only source compiler preserves exact vectors and rejects source identity drift', () => {
  const input = fixture();
  const plans = compileElevenMigrationRehearsalSources(input.bundle.migrations, input.materials);
  expect(plans).toHaveLength(11);
  expect(plans.map(plan => plan.sourceSha256)).toEqual(manifest.migrations.map((migration: any) => migration.sha256));
  expect(plans.map(plan => plan.vectorSha256)).toEqual(manifest.migrations.map((migration: any) => migration.statementVectorSha256));
  {
    const drifted = fixture();
    drifted.materials[0].bytes = Buffer.concat([drifted.materials[0].bytes, Buffer.from(' ')]);
    expect(() => compileElevenMigrationRehearsalSources(
      drifted.bundle.migrations,
      drifted.materials,
    )).toThrow('MIGRATION_FILE_DIGEST_MISMATCH');
  }
  {
    const drifted = fixture();
    [drifted.bundle.migrations[0], drifted.bundle.migrations[1]] = [
      drifted.bundle.migrations[1],
      drifted.bundle.migrations[0],
    ];
    [drifted.materials[0], drifted.materials[1]] = [drifted.materials[1], drifted.materials[0]];
    expect(() => compileElevenMigrationRehearsalSources(
      drifted.bundle.migrations,
      drifted.materials,
    )).toThrow('MIGRATION_BUNDLE_ORDER_OR_IDENTITY_INVALID');
  }
});

test('lost acknowledgement reconciles exactly once and never resends the eleven mutations', () => {
  const input = fixture();
  const compiled = compileElevenMigrationBundle(input.bundle, input.materials);
  const calls: string[] = [];
  expect(() => executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: (_url, sql) => {
    calls.push(sql);
    if (calls.length === 1) throw new Error('lost acknowledgement');
    return JSON.stringify(compiled.finalReadback.expected);
  } })).toThrow('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(2);
  expect(calls[0].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(calls[1]).not.toContain('INSERT INTO');
  expect(bundleReconciliationOutcome(compiled.finalReadback.expected, compiled)).toBe('committed');
  expect(bundleReconciliationOutcome(compiled.priorReadback.expected, compiled)).toBe('not_applied');
});

test('post-lock successor expiry survives bounded reconciliation unchanged', () => {
  const input = fixture();
  const compiled = compileElevenMigrationBundle(input.bundle, input.materials);
  const calls: string[] = [];
  const expired = Object.assign(new Error('provider detail must not escape'), {
    code: 'SUCCESSOR_ADMISSION_EXPIRED',
  });
  expect(() => executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: (_url, sql) => {
    calls.push(sql);
    if (calls.length === 1) throw expired;
    return JSON.stringify(compiled.priorReadback.expected);
  } })).toThrow('SUCCESSOR_ADMISSION_EXPIRED');
  expect(calls).toHaveLength(2);
  expect(calls[0].match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(11);
  expect(calls[1]).not.toContain('INSERT INTO');
});
