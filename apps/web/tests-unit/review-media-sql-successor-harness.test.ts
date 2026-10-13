import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createOwnedDatabase,
  dropOwnedDatabase,
  inspectRetainedProof,
} from '../performance/review-db-successor-20261012/verify-review-media-sql-successor.mjs';

const retainedProofRepositoryPath = 'apps/web/performance/review-db-successor-20261012/pg17-local-replay.json';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('retained proof is checksum-verified and distinguished from the current harness source', () => {
  const manifestBytes = readFileSync(new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const harnessBytes = readFileSync(new URL(
    '../performance/review-db-successor-20261012/verify-review-media-sql-successor.mjs',
    import.meta.url,
  ));
  const retained = inspectRetainedProof({
    currentBindings: {
      manifestSha256: sha256(manifestBytes),
      rehearsalHarnessSha256: sha256(harnessBytes),
      sourceRoot: manifest.sourceRoot,
    },
  });

  expect(retained).toMatchObject({
    present: true,
    classification: 'retained-historical-evidence',
    repositoryPath: retainedProofRepositoryPath,
    expectedSha256: '6f5dc5c5603c8a4d8b601d3edb28009e454e955292a65707747e66f274557b3f',
    actualSha256: '6f5dc5c5603c8a4d8b601d3edb28009e454e955292a65707747e66f274557b3f',
    currentSourceMatch: false,
    usedAsCurrentProof: false,
  });
  expect(retained.bindingDifferences.some(({ field }: { field: string }) => (
    field === 'rehearsalHarnessSha256'
  ))).toBe(true);
});

test('retained proof with bytes not authorized by SHA256SUMS is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-retained-proof-'));
  try {
    const outputPath = join(directory, 'pg17-local-replay.json');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const proof = Buffer.from(`${JSON.stringify({
      status: 'passed',
      temporaryDatabaseDropped: true,
      hostedWrites: false,
      operatingWrites: false,
      manifestSha256: '1'.repeat(64),
      rehearsalHarnessSha256: '2'.repeat(64),
      sourceRoot: '3'.repeat(64),
    })}\n`);
    writeFileSync(outputPath, proof);
    writeFileSync(checksumsPath, `${sha256(proof)}  ${retainedProofRepositoryPath}\n`);
    writeFileSync(outputPath, Buffer.concat([proof, Buffer.from(' ')]));

    expect(() => inspectRetainedProof({
      outputPath,
      checksumsPath,
      currentBindings: {
        manifestSha256: '1'.repeat(64),
        rehearsalHarnessSha256: '2'.repeat(64),
        sourceRoot: '3'.repeat(64),
      },
    })).toThrow('LOCAL_REHEARSAL_RETAINED_SHA256_MISMATCH');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, failingDatabaseCall, expectedCode] of [
  ['predecessor', 1, 'LOCAL_REHEARSAL_PREDECESSOR_FAILED'],
  ['fixture', 7, 'fixture failed'],
] as const) {
  test(`owned database is cleaned after ${label} SQL fails`, () => {
    const ownership = { database: false };
    let databaseExists = false;
    let databaseCalls = 0;
    let drops = 0;
    const dependencies = {
      scalarImpl: () => (databaseExists ? '1' : '0'),
      readFileImpl: () => Buffer.from('-- predecessor fixture'),
      psqlImpl: (database: string, sql: string | Buffer) => {
        const statement = sql.toString();
        if (database === 'postgres' && statement.startsWith('CREATE DATABASE ')) {
          databaseExists = true;
          return {};
        }
        if (database === 'postgres' && statement.startsWith('DROP DATABASE ')) {
          databaseExists = false;
          drops += 1;
          return {};
        }
        databaseCalls += 1;
        if (databaseCalls === failingDatabaseCall) throw new Error(`${label} failed`);
        return {};
      },
    };

    try {
      createOwnedDatabase(ownership, dependencies);
      throw new Error('expected fixture construction to fail');
    } catch (error) {
      expect((error as Error).message).toContain(expectedCode);
      expect(ownership.database).toBe(true);
    } finally {
      dropOwnedDatabase(ownership, dependencies);
    }

    expect(databaseExists).toBe(false);
    expect(ownership.database).toBe(false);
    expect(drops).toBe(1);
  });
}

test('pre-existing database is never acquired or dropped', () => {
  const ownership = { database: false };
  let databaseExists = true;
  let scalarCalls = 0;
  let psqlCalls = 0;
  const dependencies = {
    scalarImpl: () => {
      scalarCalls += 1;
      return databaseExists ? '1' : '0';
    },
    readFileImpl: () => Buffer.from(''),
    psqlImpl: () => {
      psqlCalls += 1;
      databaseExists = false;
      return {};
    },
  };

  expect(() => createOwnedDatabase(ownership, dependencies)).toThrow('LOCAL_REHEARSAL_TARGET_ALREADY_EXISTS');
  expect(dropOwnedDatabase(ownership, dependencies)).toBe(false);
  expect(databaseExists).toBe(true);
  expect(ownership.database).toBe(false);
  expect(scalarCalls).toBe(1);
  expect(psqlCalls).toBe(0);
});
