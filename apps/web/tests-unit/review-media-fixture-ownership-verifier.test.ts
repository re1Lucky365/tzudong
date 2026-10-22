import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  assertFixtureOwnershipBindings,
  fixtureOwnershipBindings,
} from '../performance/review-db-successor-20261012/verify-fixture-ownership.mjs';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = new Map([
  ['verify-review-media-sql-successor.mjs', Buffer.from('fixture role and database helper')],
  ['verify-review-media-sql-rehearsal.mjs', Buffer.from('container ownership helper')],
  ['verify-fixture-ownership.mjs', Buffer.from('ownership verifier')],
]);
const readFileImpl = (path: string) => {
  const bytes = sourceBytes.get(basename(path));
  if (!bytes) throw new Error('unexpected source path');
  return bytes;
};

test('ownership evidence binds both imported implementations and the verifier', () => {
  const bindings = fixtureOwnershipBindings({ readFileImpl });
  expect(bindings).toEqual({
    sourceSha256: sha256(sourceBytes.get('verify-review-media-sql-successor.mjs')!),
    containerHelperSha256: sha256(sourceBytes.get('verify-review-media-sql-rehearsal.mjs')!),
    verifierSha256: sha256(sourceBytes.get('verify-fixture-ownership.mjs')!),
  });
  expect(assertFixtureOwnershipBindings(bindings, { readFileImpl })).toEqual(bindings);
});

for (const path of sourceBytes.keys()) {
  test(`changed ${path} invalidates ownership evidence`, () => {
    const bindings = fixtureOwnershipBindings({ readFileImpl });
    const changedReader = (sourcePath: string) => basename(sourcePath) === path
      ? Buffer.from('changed implementation') : readFileImpl(sourcePath);
    expect(() => assertFixtureOwnershipBindings(bindings, { readFileImpl: changedReader }))
      .toThrow('FIXTURE_OWNERSHIP_SOURCE_CHANGED');
  });
}
