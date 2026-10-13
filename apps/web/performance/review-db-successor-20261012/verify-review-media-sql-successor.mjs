#!/usr/bin/env node

/**
 * Local-only PostgreSQL 17.6 rehearsal for the held eleven-stage successor.
 *
 * The harness clones the existing schema-only ranking_clone template into one
 * per-process, owned database name. It refuses a reused target, never connects
 * to a hosted endpoint, and drops the owned database before emitting its
 * current-source result.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import {
  buildSuccessorStateQuery,
  compileSuccessorPlan,
  loadSuccessorManifest,
} from '../../scripts/review-media-sql-successor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../../..');
const OUTPUT_PATH = resolve(HERE, 'pg17-local-replay.json');
const CHECKSUMS_PATH = resolve(HERE, 'SHA256SUMS');
const RETAINED_PROOF_REPOSITORY_PATH = 'apps/web/performance/review-db-successor-20261012/pg17-local-replay.json';
const DOCKER_CONTEXT = process.env.TZUDONG_REHEARSAL_DOCKER_CONTEXT || 'colima-tzudong-catalog-20261007';
const DOCKER_CONTAINER = process.env.TZUDONG_REHEARSAL_DOCKER_CONTAINER || 'tzudong-ranking-clone-20261008';
const TEMPLATE_DATABASE = 'ranking_clone';
const DATABASE = `review_successor_local_${randomBytes(16).toString('hex')}`;
const FIXTURE_PASSWORD = 'fixture-only';
const FIXTURE_PARENT_ROLE = 'review_successor_fixture_parent_20261012';
const FIXTURE_MEMBER_ROLE = 'review_successor_fixture_member_20261012';
const FIXTURE_OWNER_PREFIX = 'tzudong-review-successor-fixture';
const EXPIRY_APPLICATION_NAME = 'tzudong-review-successor-expiry-fixture';
const PREDECESSOR_PATHS = Object.freeze([
  'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql',
  'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql',
  'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql',
  'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql',
  'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql',
  'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql',
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', ['--context', DOCKER_CONTEXT, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const sqlstates = [...(result.stderr || '').matchAll(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/g)]
      .map(match => match[1]);
    const diagnostic = (result.stderr || '').split(/\r?\n/)
      .find(line => /(?:ERROR|FATAL):/.test(line))
      ?.replace(/\s+/g, ' ').slice(0, 240) || '';
    fail('LOCAL_REHEARSAL_COMMAND_FAILED', [sqlstates.join(',') || String(result.status), diagnostic]
      .filter(Boolean).join(':'));
  }
  return result;
}

function psql(database, sql, { actor = 'postgres', singleTransaction = false, allowFailure = false } = {}) {
  const options = [
    'exec', '-i', '-e', `PGPASSWORD=${FIXTURE_PASSWORD}`, DOCKER_CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
  ];
  if (singleTransaction) options.push('--single-transaction');
  options.push('-h', '127.0.0.1', '-U', actor, '-d', database, '--file=-');
  return docker(options, { input: sql, allowFailure });
}

function scalar(database, sql, actor = 'postgres') {
  return psql(database, `${sql}\n`, { actor }).stdout.trim();
}

function readState(database, stateQuery) {
  const output = scalar(database, `${stateQuery};`);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('LOCAL_REHEARSAL_STATE_SHAPE_INVALID', String(lines.length));
  try {
    return JSON.parse(lines[0]);
  } catch {
    fail('LOCAL_REHEARSAL_STATE_JSON_INVALID');
  }
}

function ledgerInsert(migration) {
  const vector = JSON.stringify(migration.originalStatementVector);
  const tag = `$vector_${sha256(vector).slice(0, 20)}$`;
  return `INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
SELECT ${quote(migration.version)},ARRAY(SELECT jsonb_array_elements_text(${tag}${vector}${tag}::jsonb)),${quote(migration.name)};`;
}

function fixtureSql() {
  return `
DO $fixture$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>0 THEN
  RAISE EXCEPTION 'LOCAL_REHEARSAL_LEDGER_NOT_EMPTY';
 END IF;
 IF (SELECT count(*) FROM public.profiles)<>0 OR (SELECT count(*) FROM public.reviews)<>0 THEN
  RAISE EXCEPTION 'LOCAL_REHEARSAL_PERSONAL_ROWS_PRESENT';
 END IF;
END $fixture$;
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
SELECT lpad(value::text,14,'0'),ARRAY['local schema-only predecessor fixture'],format('local_predecessor_%s',value)
FROM generate_series(1,86) value;
INSERT INTO pipeline_control.restaurant_review_policy(singleton,enabled)
VALUES(true,false)
ON CONFLICT(singleton) DO UPDATE SET enabled=false,operator_id=NULL,last_run_at=NULL;
INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision)
VALUES(true,1)
ON CONFLICT(singleton) DO NOTHING;
`;
}

function databaseMetadataSql(databaseName) {
  const projection = alias => `jsonb_build_object(
    'name',${alias}.datname,
    'owner',pg_get_userbyid(${alias}.datdba),
    'encoding',pg_encoding_to_char(${alias}.encoding),
    'collate',${alias}.datcollate,
    'ctype',${alias}.datctype,
    'localeProvider',${alias}.datlocprovider::text,
    'allowConnections',${alias}.datallowconn,
    'isTemplate',${alias}.datistemplate
  )`;
  return `SELECT jsonb_build_object(
  'target',(SELECT ${projection('target_database')} FROM pg_database target_database
    WHERE target_database.datname=${quote(databaseName)}),
  'template',(SELECT ${projection('template_database')} FROM pg_database template_database
    WHERE template_database.datname=${quote(TEMPLATE_DATABASE)})
)::text;`;
}

function inspectDatabaseOwnership(databaseName, { scalarImpl = scalar } = {}) {
  let state;
  try {
    state = JSON.parse(scalarImpl('postgres', databaseMetadataSql(databaseName), 'supabase_admin'));
  } catch {
    fail('LOCAL_REHEARSAL_DATABASE_STATE_INVALID');
  }
  if (!state
    || typeof state !== 'object'
    || !Object.hasOwn(state, 'target')
    || !databaseMetadataValid(state.template)
    || state.template.name !== TEMPLATE_DATABASE
    || (state.target !== null && !databaseMetadataValid(state.target))) {
    fail('LOCAL_REHEARSAL_DATABASE_STATE_INVALID');
  }
  return state;
}

function databaseMetadataValid(metadata) {
  return metadata
    && typeof metadata === 'object'
    && ['name', 'owner', 'encoding', 'collate', 'ctype', 'localeProvider']
      .every(field => typeof metadata[field] === 'string' && metadata[field].length > 0)
    && typeof metadata.allowConnections === 'boolean'
    && typeof metadata.isTemplate === 'boolean';
}

function databaseTargetAbsent(state, databaseName) {
  return state?.target === null && state?.template?.name === TEMPLATE_DATABASE && databaseName === DATABASE;
}

function databaseTargetOwned(state, baseline, databaseName) {
  const target = state?.target;
  const template = state?.template;
  return databaseTargetAbsent(baseline, databaseName)
    && target?.name === databaseName
    && target.owner === 'postgres'
    && target.allowConnections === true
    && target.isTemplate === false
    && template?.name === TEMPLATE_DATABASE
    && equal(template, baseline.template)
    && target.encoding === template.encoding
    && target.collate === template.collate
    && target.ctype === template.ctype
    && target.localeProvider === template.localeProvider;
}

export function createOwnedDatabase(ownership, {
  scalarImpl = scalar,
  psqlImpl = psql,
  readFileImpl = readFileSync,
} = {}) {
  if (!ownership
    || ownership.database !== false
    || ownership.databaseAttempted
    || ownership.databaseName
    || ownership.databaseBaseline) {
    fail('LOCAL_REHEARSAL_OWNERSHIP_STATE_INVALID');
  }
  const baseline = inspectDatabaseOwnership(DATABASE, { scalarImpl });
  if (!databaseTargetAbsent(baseline, DATABASE)) fail('LOCAL_REHEARSAL_TARGET_ALREADY_EXISTS');
  ownership.databaseName = DATABASE;
  ownership.databaseBaseline = baseline;
  ownership.databaseAttempted = true;
  let creationAcknowledged = false;
  try {
    psqlImpl('postgres', `CREATE DATABASE ${DATABASE} TEMPLATE ${TEMPLATE_DATABASE} OWNER postgres;`, { actor: 'supabase_admin' });
    creationAcknowledged = true;
  } catch {
    // CREATE is intentionally never replayed. The exact catalog readback below
    // distinguishes a committed CREATE from a failure before mutation.
  }
  let observed;
  try {
    observed = inspectDatabaseOwnership(DATABASE, { scalarImpl });
  } catch {
    fail('LOCAL_REHEARSAL_DATABASE_READBACK_FAILED');
  }
  if (!databaseTargetOwned(observed, baseline, DATABASE)) {
    if (databaseTargetAbsent(observed, DATABASE)) {
      ownership.databaseAttempted = false;
      ownership.databaseName = null;
      ownership.databaseBaseline = null;
      fail('LOCAL_REHEARSAL_DATABASE_CREATION_UNCONFIRMED');
    }
    fail('LOCAL_REHEARSAL_DATABASE_OWNERSHIP_UNPROVEN');
  }
  ownership.database = true;
  ownership.databaseCreationAcknowledged = creationAcknowledged;
  ownership.databaseCreationReconciled = !creationAcknowledged;
  PREDECESSOR_PATHS.forEach((path, index) => {
    try {
      psqlImpl(DATABASE, readFileImpl(resolve(REPOSITORY_ROOT, path)));
    } catch (error) {
      fail('LOCAL_REHEARSAL_PREDECESSOR_FAILED', `${index + 1}:${error.message}`);
    }
  });
  psqlImpl(DATABASE, fixtureSql());
  return true;
}

export function dropOwnedDatabase(ownership, { scalarImpl = scalar, psqlImpl = psql } = {}) {
  if (!ownership?.database && !ownership?.databaseAttempted) return false;
  if (ownership.databaseName !== DATABASE
    || !ownership.databaseBaseline
    || !databaseTargetAbsent(ownership.databaseBaseline, DATABASE)) {
    fail('LOCAL_REHEARSAL_DATABASE_OWNERSHIP_STATE_INVALID');
  }
  let before;
  try {
    before = inspectDatabaseOwnership(DATABASE, { scalarImpl });
  } catch {
    fail('LOCAL_REHEARSAL_DATABASE_CLEANUP_READBACK_FAILED');
  }
  if (databaseTargetAbsent(before, DATABASE)) {
    const wasOwned = ownership.database === true;
    ownership.database = false;
    ownership.databaseAttempted = false;
    ownership.databaseDropped = wasOwned;
    ownership.databaseCleanupReconciled = true;
    ownership.databaseName = null;
    ownership.databaseBaseline = null;
    return false;
  }
  if (!databaseTargetOwned(before, ownership.databaseBaseline, DATABASE)) {
    fail('LOCAL_REHEARSAL_DATABASE_OWNERSHIP_UNPROVEN');
  }
  ownership.database = true;
  let removalAcknowledged = false;
  try {
    psqlImpl('postgres', `DROP DATABASE ${DATABASE} WITH (FORCE);`, { actor: 'supabase_admin' });
    removalAcknowledged = true;
  } catch {
    // A lost DROP acknowledgement is reconciled once; DROP is not replayed.
  }
  let after;
  try {
    after = inspectDatabaseOwnership(DATABASE, { scalarImpl });
  } catch {
    fail('LOCAL_REHEARSAL_DATABASE_CLEANUP_READBACK_FAILED');
  }
  if (!databaseTargetAbsent(after, DATABASE)) {
    if (!databaseTargetOwned(after, ownership.databaseBaseline, DATABASE)) {
      fail('LOCAL_REHEARSAL_DATABASE_OWNERSHIP_UNPROVEN');
    }
    fail('LOCAL_REHEARSAL_DATABASE_DROP_UNCONFIRMED');
  }
  ownership.database = false;
  ownership.databaseAttempted = false;
  ownership.databaseDropped = true;
  ownership.databaseRemovalAcknowledged = removalAcknowledged;
  ownership.databaseCleanupReconciled = !removalAcknowledged;
  ownership.databaseName = null;
  ownership.databaseBaseline = null;
  return true;
}

function resetOwnedDatabase(ownership) {
  dropOwnedDatabase(ownership);
  createOwnedDatabase(ownership);
}

function fixtureRoleStateQuery() {
  return `WITH fixture_roles AS (
  SELECT fixture_role.rolname,
         fixture_role.rolcanlogin,
         fixture_role.rolsuper,
         fixture_role.rolcreatedb,
         fixture_role.rolcreaterole,
         fixture_role.rolinherit,
         fixture_role.rolreplication,
         fixture_role.rolbypassrls,
         fixture_role.rolconnlimit,
         fixture_role.rolvaliduntil,
         fixture_role.rolconfig,
         coalesce(shobj_description(fixture_role.oid,'pg_authid'),'') AS owner_marker
  FROM pg_roles fixture_role
  WHERE fixture_role.rolname IN(${quote(FIXTURE_PARENT_ROLE)},${quote(FIXTURE_MEMBER_ROLE)})
), fixture_memberships AS (
  SELECT parent.rolname AS parent,
         member.rolname AS member,
         grantor.rolname AS grantor,
         membership.admin_option,
         membership.inherit_option,
         membership.set_option
  FROM pg_auth_members membership
  JOIN pg_roles parent ON parent.oid=membership.roleid
  JOIN pg_roles member ON member.oid=membership.member
  JOIN pg_roles grantor ON grantor.oid=membership.grantor
  WHERE parent.rolname IN(${quote(FIXTURE_PARENT_ROLE)},${quote(FIXTURE_MEMBER_ROLE)})
     OR member.rolname IN(${quote(FIXTURE_PARENT_ROLE)},${quote(FIXTURE_MEMBER_ROLE)})
)
SELECT jsonb_build_object(
  'roles',coalesce((SELECT jsonb_agg(to_jsonb(fixture_role) ORDER BY fixture_role.rolname) FROM fixture_roles fixture_role),'[]'::jsonb),
  'memberships',coalesce((SELECT jsonb_agg(to_jsonb(fixture_membership) ORDER BY fixture_membership.parent,fixture_membership.member,fixture_membership.grantor) FROM fixture_memberships fixture_membership),'[]'::jsonb)
)::text;`;
}

function inspectFixtureMembership({ scalarImpl = scalar } = {}) {
  let output;
  try {
    output = scalarImpl('postgres', fixtureRoleStateQuery(), 'supabase_admin');
  } catch {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_READBACK_FAILED');
  }
  let state;
  try {
    state = JSON.parse(output);
  } catch {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_READBACK_INVALID');
  }
  if (!Array.isArray(state?.roles) || !Array.isArray(state?.memberships)) {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_READBACK_INVALID');
  }
  return Object.freeze({
    roles: Object.freeze(state.roles.map(role => Object.freeze({ ...role }))),
    memberships: Object.freeze(state.memberships.map(membership => Object.freeze({ ...membership }))),
  });
}

function fixtureMembershipAbsent(state) {
  return state.roles.length === 0 && state.memberships.length === 0;
}

function fixtureMembershipOwned(state, token) {
  const roles = new Map(state.roles.map(role => [role.rolname, role]));
  const parent = roles.get(FIXTURE_PARENT_ROLE);
  const member = roles.get(FIXTURE_MEMBER_ROLE);
  const membership = state.memberships[0];
  const sharedRoleShape = role => role
    && role.rolcanlogin === false
    && role.rolsuper === false
    && role.rolcreatedb === false
    && role.rolcreaterole === false
    && role.rolreplication === false
    && role.rolbypassrls === false
    && role.rolconnlimit === -1
    && role.rolvaliduntil === null
    && role.rolconfig === null;
  return state.roles.length === 2
    && sharedRoleShape(parent)
    && parent.rolinherit === false
    && parent.owner_marker === `${FIXTURE_OWNER_PREFIX}:${token}:parent`
    && sharedRoleShape(member)
    && member.rolinherit === true
    && member.owner_marker === `${FIXTURE_OWNER_PREFIX}:${token}:member`
    && state.memberships.length === 1
    && membership.parent === FIXTURE_PARENT_ROLE
    && membership.member === FIXTURE_MEMBER_ROLE
    && membership.grantor === 'supabase_admin'
    && membership.admin_option === false
    && membership.inherit_option === true
    && membership.set_option === true;
}

export function createFixtureMembership(ownership, {
  scalarImpl = scalar,
  psqlImpl = psql,
  generateToken = () => randomBytes(16).toString('hex'),
} = {}) {
  if (!ownership
    || ownership.fixtureMembership !== false
    || ownership.fixtureMembershipAttempted
    || ownership.fixtureMembershipToken
    || ownership.fixtureMembershipBaseline) {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_STATE_INVALID');
  }
  const baseline = inspectFixtureMembership({ scalarImpl });
  ownership.fixtureMembershipBaseline = baseline;
  if (!fixtureMembershipAbsent(baseline)) fail('LOCAL_REHEARSAL_FIXTURE_ROLE_EXISTS');
  const token = generateToken();
  if (!/^[0-9a-f]{32}$/.test(token)) fail('LOCAL_REHEARSAL_FIXTURE_ROLE_TOKEN_INVALID');
  ownership.fixtureMembershipToken = token;
  ownership.fixtureMembershipAttempted = true;
  let creationAcknowledged = false;
  try {
    psqlImpl('postgres', `
BEGIN;
CREATE ROLE ${FIXTURE_PARENT_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${FIXTURE_MEMBER_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
COMMENT ON ROLE ${FIXTURE_PARENT_ROLE} IS ${quote(`${FIXTURE_OWNER_PREFIX}:${token}:parent`)};
COMMENT ON ROLE ${FIXTURE_MEMBER_ROLE} IS ${quote(`${FIXTURE_OWNER_PREFIX}:${token}:member`)};
GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE}
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;
COMMIT;
`, { actor: 'supabase_admin' });
    creationAcknowledged = true;
  } catch {}
  const observed = inspectFixtureMembership({ scalarImpl });
  if (!fixtureMembershipOwned(observed, token)) {
    ownership.fixtureMembershipAttempted = false;
    if (fixtureMembershipAbsent(observed)) fail('LOCAL_REHEARSAL_FIXTURE_ROLE_CREATION_UNCONFIRMED');
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
  }
  ownership.fixtureMembership = true;
  ownership.fixtureMembershipCreationAcknowledged = creationAcknowledged;
  ownership.fixtureMembershipCreationReconciled = !creationAcknowledged;
  return true;
}

export function dropFixtureMembership(ownership, {
  scalarImpl = scalar,
  psqlImpl = psql,
} = {}) {
  if (!ownership?.fixtureMembership && !ownership?.fixtureMembershipAttempted) return false;
  const token = ownership.fixtureMembershipToken;
  if (!/^[0-9a-f]{32}$/.test(token || '')
    || !ownership.fixtureMembershipBaseline
    || !fixtureMembershipAbsent(ownership.fixtureMembershipBaseline)) {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_STATE_INVALID');
  }
  const before = inspectFixtureMembership({ scalarImpl });
  if (fixtureMembershipAbsent(before)) {
    const wasOwned = ownership.fixtureMembership === true;
    ownership.fixtureMembership = false;
    ownership.fixtureMembershipAttempted = false;
    ownership.fixtureMembershipDropped = wasOwned;
    ownership.fixtureMembershipCleanupReconciled = true;
    return wasOwned;
  }
  if (!fixtureMembershipOwned(before, token)) {
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
  }
  // An earlier creation readback can fail after COMMIT. Exact token, shape,
  // membership, and empty preimage establish this run's cleanup authority.
  ownership.fixtureMembership = true;
  let removalAcknowledged = false;
  try {
    psqlImpl('postgres', `
BEGIN;
REVOKE ${FIXTURE_PARENT_ROLE} FROM ${FIXTURE_MEMBER_ROLE} GRANTED BY supabase_admin;
DROP ROLE ${FIXTURE_MEMBER_ROLE};
DROP ROLE ${FIXTURE_PARENT_ROLE};
COMMIT;
`, { actor: 'supabase_admin' });
    removalAcknowledged = true;
  } catch {}
  const after = inspectFixtureMembership({ scalarImpl });
  if (!fixtureMembershipAbsent(after)) {
    if (!fixtureMembershipOwned(after, token)) {
      fail('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
    }
    fail('LOCAL_REHEARSAL_FIXTURE_ROLE_REMOVAL_UNCONFIRMED');
  }
  ownership.fixtureMembership = false;
  ownership.fixtureMembershipAttempted = false;
  ownership.fixtureMembershipDropped = true;
  ownership.fixtureMembershipRemovalAcknowledged = removalAcknowledged;
  return true;
}

function cleanupOwnedFixtures(ownership) {
  const failures = [];
  try {
    dropOwnedDatabase(ownership);
  } catch (error) {
    failures.push(`database:${error.message}`);
  }
  try {
    dropFixtureMembership(ownership);
  } catch (error) {
    failures.push(`roles:${error.message}`);
  }
  if (failures.length > 0) fail('LOCAL_REHEARSAL_CLEANUP_FAILED', failures.join(','));
}

export function inspectRetainedProof({
  outputPath = OUTPUT_PATH,
  checksumsPath = CHECKSUMS_PATH,
  currentBindings,
  existsImpl = existsSync,
  readFileImpl = readFileSync,
} = {}) {
  if (!existsImpl(outputPath)) return Object.freeze({ present: false });
  if (!currentBindings || typeof currentBindings !== 'object') {
    fail('LOCAL_REHEARSAL_CURRENT_BINDINGS_INVALID');
  }
  const checksumLines = readFileImpl(checksumsPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const matchingLines = checksumLines.filter(line => line.endsWith(`  ${RETAINED_PROOF_REPOSITORY_PATH}`));
  if (matchingLines.length !== 1) fail('LOCAL_REHEARSAL_RETAINED_CHECKSUM_MISSING');
  const checksumMatch = matchingLines[0].match(/^([0-9a-f]{64})  (.+)$/);
  if (!checksumMatch || checksumMatch[2] !== RETAINED_PROOF_REPOSITORY_PATH) {
    fail('LOCAL_REHEARSAL_RETAINED_CHECKSUM_INVALID');
  }
  const bytes = readFileImpl(outputPath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== checksumMatch[1]) fail('LOCAL_REHEARSAL_RETAINED_SHA256_MISMATCH');
  let retained;
  try {
    retained = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('LOCAL_REHEARSAL_RETAINED_JSON_INVALID');
  }
  const retainedBindings = {
    manifestSha256: retained.manifestSha256,
    rehearsalHarnessSha256: retained.rehearsalHarnessSha256,
    sourceRoot: retained.sourceRoot,
  };
  if (retained.status !== 'passed'
    || retained.temporaryDatabaseDropped !== true
    || retained.hostedWrites !== false
    || retained.operatingWrites !== false
    || Object.values(retainedBindings).some(value => !/^[0-9a-f]{64}$/.test(value))) {
    fail('LOCAL_REHEARSAL_RETAINED_SHAPE_INVALID');
  }
  const bindingDifferences = Object.keys(retainedBindings)
    .filter(key => retainedBindings[key] !== currentBindings[key])
    .map(key => ({
      field: key,
      retained: retainedBindings[key],
      current: currentBindings[key],
    }));
  return Object.freeze({
    present: true,
    classification: 'retained-historical-evidence',
    repositoryPath: RETAINED_PROOF_REPOSITORY_PATH,
    expectedSha256: checksumMatch[1],
    actualSha256,
    bindings: Object.freeze(retainedBindings),
    currentSourceMatch: bindingDifferences.length === 0,
    bindingDifferences: Object.freeze(bindingDifferences),
    usedAsCurrentProof: false,
  });
}

function applyRawMigration(record, index) {
  const migration = record.manifest.migrations[index];
  const material = record.materials[index];
  try {
    psql(DATABASE, material.bytes);
    psql(DATABASE, `${ledgerInsert(migration)}\n`);
  } catch (error) {
    fail('LOCAL_REHEARSAL_MIGRATION_FAILED', `${index + 1}:${error.message}`);
  }
}

function collectStageStates(record, stateQuery) {
  const states = [readState(DATABASE, stateQuery)];
  for (let index = 0; index < record.manifest.migrations.length; index += 1) {
    applyRawMigration(record, index);
    states.push(readState(DATABASE, stateQuery));
  }
  return states;
}

function summarizeStage(stage, index) {
  return {
    index,
    ledgerCount: stage.bundle.ledgerCount,
    targetCount: stage.bundle.targetCount,
    prefixRoot: stage.bundle.prefixRoot,
    suffixRoot: stage.bundle.suffixRoot,
    schemaRoot: stage.state.schemaRoot,
    ledgerRoot: stage.state.ledgerRoot,
    g014Root: stage.state.g014Root,
    storageRoot: stage.state.storageRoot,
    finishCleanupBodySha256: stage.state.finishCleanupBodySha256,
    ownerAuthorityReady: stage.state.ownerAuthorityReady,
    terminalContractReady: stage.state.terminalContractReady,
  };
}

function assertRehearsalStages(record, stages) {
  const { manifest } = record;
  if (stages.length !== 12) fail('LOCAL_REHEARSAL_STAGE_COUNT_INVALID');
  const prefixRoot = stages[0].bundle.prefixRoot;
  stages.forEach((stage, index) => {
    if (stage.bundle.ledgerCount !== 86 + index
      || stage.bundle.priorCount !== 86
      || stage.bundle.prefixRoot !== prefixRoot
      || stage.bundle.targetCount !== index
      || stage.state.activeReviewItems !== 0
      || stage.state.reviewItems !== 0
      || stage.state.reviewRuns !== 0
      || stage.state.reviewPolicyEnabled !== false
      || stage.state.currentUser !== 'postgres'
      || stage.state.sessionUser !== 'postgres'
      || stage.state.databaseName !== DATABASE
      || stage.state.serverMajor !== 17
      || stage.state.ownerAuthorityReady !== true
      || stage.state.terminalContractReady !== (index === 11)) {
      fail('LOCAL_REHEARSAL_STAGE_INVALID', String(index));
    }
  });
  if (stages[10].state.finishCleanupBodySha256 !== manifest.terminalContract.finishPreimageSha256
    || stages[11].state.finishCleanupBodySha256 !== manifest.terminalContract.finishPostimageSha256) {
    fail('LOCAL_REHEARSAL_FINISH_PREIMAGE_INVALID');
  }
  if (!equal(stages.slice(0, 3).map(stage => stage.state.g014Root), Array(3).fill(stages[0].state.g014Root))
    || !equal(stages.slice(4).map(stage => stage.state.g014Root), Array(8).fill(stages[4].state.g014Root))) {
    fail('LOCAL_REHEARSAL_G014_TRANSITION_INVALID');
  }
}

function tamperFinishCleanupPreimage() {
  psql(DATABASE, `
BEGIN;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members
   WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole)
 THEN RAISE EXCEPTION 'LOCAL_REHEARSAL_SELF_GRANT_EXISTS'; END IF;
END $guard$;
GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE privacy_workflow_owner;
DO $tamper$
DECLARE definition text; source text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO definition,source
 FROM pg_proc WHERE oid='public.finish_review_media_cleanup()'::regprocedure;
 EXECUTE replace(definition,source,source || E'\\n-- local-only preimage drift');
END $tamper$;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
COMMIT;
`);
}

function assertCatalogDriftRejected({ label, ownership, plan, stages, stateQuery, tamperSql, restoreSql = null }) {
  resetOwnedDatabase(ownership);
  const baseline = readState(DATABASE, stateQuery);
  if (!equal(baseline, stages[0])) fail('LOCAL_REHEARSAL_DRIFT_BASELINE_INVALID', label);
  psql(DATABASE, tamperSql, { actor: 'supabase_admin' });
  const driftedBefore = readState(DATABASE, stateQuery);
  if (driftedBefore.state.schemaRoot === baseline.state.schemaRoot
    || driftedBefore.state.g014Root !== baseline.state.g014Root
    || driftedBefore.state.storageRoot !== baseline.state.storageRoot
    || driftedBefore.state.ledgerRoot !== baseline.state.ledgerRoot) {
    fail('LOCAL_REHEARSAL_DRIFT_PROJECTION_INVALID', label);
  }
  const rejected = psql(DATABASE, plan.sql, { singleTransaction: true, allowFailure: true });
  if (rejected.status === 0 || !/MIGRATION_PRIOR_STATE_MISMATCH/.test(rejected.stderr)) {
    fail('LOCAL_REHEARSAL_CATALOG_DRIFT_NOT_REJECTED', label);
  }
  const driftedAfter = readState(DATABASE, stateQuery);
  if (!equal(driftedBefore, driftedAfter)
    || driftedAfter.bundle.targetCount !== 0
    || driftedAfter.bundle.ledgerCount !== 86) {
    fail('LOCAL_REHEARSAL_CATALOG_DRIFT_STATE_CHANGED', label);
  }
  if (restoreSql) {
    psql(DATABASE, restoreSql, { actor: 'supabase_admin' });
    if (!equal(readState(DATABASE, stateQuery), baseline)) {
      fail('LOCAL_REHEARSAL_CATALOG_DRIFT_RESTORE_FAILED', label);
    }
  }
  return true;
}

function startAdvisoryLockHolder() {
  const args = [
    '--context', DOCKER_CONTEXT,
    'exec', '-i', '-e', `PGPASSWORD=${FIXTURE_PASSWORD}`, DOCKER_CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', DATABASE,
  ];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const ready = new Promise((resolveReady, rejectReady) => {
    const reject = detail => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(`LOCAL_REHEARSAL_LOCK_HOLDER_FAILED:${detail}`));
      }
    };
    child.on('error', error => reject(error.code || 'SPAWN'));
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!settled && stdout.includes('LOCK_HELD')) {
        settled = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('exit', code => {
      if (!settled) reject(`${code}:${stderr.replace(/\s+/g, ' ').slice(0, 120)}`);
    });
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.on('error', rejectCompletion);
    child.on('close', code => {
      if (code === 0) resolveCompletion();
      else rejectCompletion(new Error(`LOCAL_REHEARSAL_LOCK_HOLDER_FAILED:${code}:${stderr.replace(/\s+/g, ' ').slice(0, 120)}`));
    });
  });
  child.stdin.end(`BEGIN;\nSELECT pg_advisory_xact_lock(7311754282260211::bigint);\nSELECT 'LOCK_HELD';\nSELECT pg_sleep(1.55);\nCOMMIT;\n`);
  return { child, completion, ready };
}

function startPsqlProcess(database, sql, { applicationName, singleTransaction = false } = {}) {
  const args = [
    '--context', DOCKER_CONTEXT,
    'exec', '-i', '-e', `PGPASSWORD=${FIXTURE_PASSWORD}`,
  ];
  if (applicationName) args.push('-e', `PGAPPNAME=${applicationName}`);
  args.push(
    DOCKER_CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
  );
  if (singleTransaction) args.push('--single-transaction');
  args.push('-h', '127.0.0.1', '-U', 'postgres', '-d', database, '--file=-');
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let inputError = null;
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') inputError = error;
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.on('error', rejectCompletion);
    child.on('close', status => {
      if (inputError) rejectCompletion(inputError);
      else resolveCompletion({ status, stderr, stdout });
    });
  });
  child.stdin.end(sql);
  return { child, completion };
}

async function waitForAdvisoryContention(expiresAt) {
  const deadline = Math.min(expiresAt - 25, Date.now() + 700);
  while (Date.now() < deadline) {
    const waiting = scalar(DATABASE, `SELECT count(*) FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid=a.pid
      WHERE a.application_name=${quote(EXPIRY_APPLICATION_NAME)}
        AND l.locktype='advisory' AND NOT l.granted;`, 'supabase_admin');
    if (waiting === '1') return Date.now();
    if (waiting !== '0') fail('LOCAL_REHEARSAL_CONTENTION_CARDINALITY_INVALID');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
  }
  fail('LOCAL_REHEARSAL_ADVISORY_CONTENTION_NOT_OBSERVED');
}

async function assertContendedExpiryRejected(record, stages, stateQuery, ownership) {
  resetOwnedDatabase(ownership);
  const baseline = readState(DATABASE, stateQuery);
  if (!equal(baseline, stages[0])) fail('LOCAL_REHEARSAL_EXPIRY_BASELINE_INVALID');
  const expiresAt = Date.now() + 1500;
  const expiry = new Date(expiresAt).toISOString();
  const expiringPlan = compileSuccessorPlan(record, { expiresAt: expiry, stageStates: stages });
  const holder = startAdvisoryLockHolder();
  let apply = null;
  try {
    await holder.ready;
    if (Date.now() >= expiresAt) fail('LOCAL_REHEARSAL_EXPIRY_WINDOW_TOO_SHORT');
    apply = startPsqlProcess(DATABASE, expiringPlan.sql, {
      applicationName: EXPIRY_APPLICATION_NAME,
      singleTransaction: true,
    });
    const contentionObservedAt = await waitForAdvisoryContention(expiresAt);
    if (contentionObservedAt >= expiresAt) fail('LOCAL_REHEARSAL_CONTENTION_OBSERVED_AFTER_EXPIRY');
    const [rejected] = await Promise.all([apply.completion, holder.completion]);
    if (rejected.status === 0
      || !/SUCCESSOR_ADMISSION_EXPIRED/.test(rejected.stderr)
      || /lock timeout/.test(rejected.stderr)) {
      fail('LOCAL_REHEARSAL_CONTENDED_EXPIRY_NOT_REJECTED');
    }
  } finally {
    if (apply?.child.exitCode === null) apply.child.kill('SIGTERM');
    if (holder.child.exitCode === null) holder.child.kill('SIGTERM');
  }
  const after = readState(DATABASE, stateQuery);
  if (!equal(after, baseline) || after.bundle.targetCount !== 0 || after.bundle.ledgerCount !== 86) {
    fail('LOCAL_REHEARSAL_CONTENDED_EXPIRY_STATE_CHANGED');
  }
  return true;
}

export async function run() {
  const manifestBytes = readFileSync(resolve(REPOSITORY_ROOT, '.github/review-media-sql-successor.v1.json'));
  const record = loadSuccessorManifest();
  const currentBindings = Object.freeze({
    manifestSha256: sha256(manifestBytes),
    rehearsalHarnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    sourceRoot: record.manifest.sourceRoot,
  });
  const retainedProof = inspectRetainedProof({ currentBindings });
  const stateQuery = buildSuccessorStateQuery(record.manifest);
  const template = JSON.parse(scalar(TEMPLATE_DATABASE, `SELECT json_build_object(
    'engine',current_setting('server_version'),
    'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
    'manifest',(SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest),
    'profiles',(SELECT count(*) FROM public.profiles),
    'reviews',(SELECT count(*) FROM public.reviews)
  )::text;`, 'supabase_admin'));
  if (!String(template.engine).startsWith('17.6')
    || template.ledger !== 0
    || template.profiles !== 0
    || template.reviews !== 0) fail('LOCAL_REHEARSAL_TEMPLATE_INVALID');

  const ownership = {
    database: false,
    databaseAttempted: false,
    databaseName: null,
    databaseBaseline: null,
    fixtureMembership: false,
    fixtureMembershipAttempted: false,
    fixtureMembershipToken: null,
    fixtureMembershipBaseline: null,
  };
  let proof;
  try {
    createFixtureMembership(ownership);
    createOwnedDatabase(ownership);
    if (scalar(DATABASE, `SELECT coalesce('security_invoker=true'=ANY(c.reloptions),false)
      FROM pg_class c WHERE c.oid='public.admin_evaluation_related_rows'::regclass;`) !== 't') {
      fail('LOCAL_REHEARSAL_SECURITY_INVOKER_BASELINE_INVALID');
    }
    if (scalar(DATABASE, `SELECT m.inherit_option::text || ':' || m.set_option::text
      FROM pg_auth_members m
      WHERE m.roleid=${quote(FIXTURE_PARENT_ROLE)}::regrole
        AND m.member=${quote(FIXTURE_MEMBER_ROLE)}::regrole
        AND m.grantor='supabase_admin'::regrole;`, 'supabase_admin') !== 'true:true') {
      fail('LOCAL_REHEARSAL_MEMBERSHIP_OPTIONS_BASELINE_INVALID');
    }
    const stages = collectStageStates(record, stateQuery);
    assertRehearsalStages(record, stages);
    const plan = compileSuccessorPlan(record, {
      expiresAt: '9999-12-31T23:59:59.999Z',
      stageStates: stages,
    });

    resetOwnedDatabase(ownership);
    let success;
    try {
      success = psql(DATABASE, plan.sql, { singleTransaction: true });
    } catch (error) {
      let stage = 0;
      const diagnosticSql = plan.sql.replaceAll('MIGRATION_TERMINAL_READBACK_FAILED', () => {
        stage += 1;
        return `MIGRATION_TERMINAL_READBACK_FAILED_STAGE_${stage}`;
      });
      try {
        psql(DATABASE, diagnosticSql, { singleTransaction: true });
      } catch (diagnostic) {
        fail('LOCAL_REHEARSAL_ATOMIC_STAGE_FAILED', diagnostic.message);
      }
      throw error;
    }
    const successLines = success.stdout.trim().split(/\r?\n/).filter(Boolean);
    const successReadback = JSON.parse(successLines.at(-1));
    const committed = readState(DATABASE, stateQuery);
    if (!equal(successReadback, stages[11]) || !equal(committed, stages[11])) {
      fail('LOCAL_REHEARSAL_COMMIT_READBACK_INVALID');
    }

    resetOwnedDatabase(ownership);
    const rollback = psql(DATABASE, `${plan.sql}\nDO $forced$ BEGIN RAISE EXCEPTION 'LOCAL_FORCED_ROLLBACK'; END $forced$;\n`, {
      singleTransaction: true,
      allowFailure: true,
    });
    if (rollback.status === 0 || !/LOCAL_FORCED_ROLLBACK/.test(rollback.stderr)) {
      fail('LOCAL_REHEARSAL_FORCED_ROLLBACK_MISSING');
    }
    const rolledBack = readState(DATABASE, stateQuery);
    if (!equal(rolledBack, stages[0])) fail('LOCAL_REHEARSAL_ROLLBACK_DRIFT');

    resetOwnedDatabase(ownership);
    for (let index = 0; index < 10; index += 1) applyRawMigration(record, index);
    const cleanPreimage = readState(DATABASE, stateQuery);
    if (!equal(cleanPreimage, stages[10])) fail('LOCAL_REHEARSAL_STAGE10_REPLAY_DRIFT');
    tamperFinishCleanupPreimage();
    const tamperedBefore = readState(DATABASE, stateQuery);
    const wrongPreimage = psql(DATABASE, record.materials[10].bytes, { allowFailure: true });
    if (wrongPreimage.status === 0 || !/REVIEW_SHARED_SOURCE_DRIFT/.test(wrongPreimage.stderr)) {
      fail('LOCAL_REHEARSAL_WRONG_PREIMAGE_NOT_REJECTED');
    }
    const tamperedAfter = readState(DATABASE, stateQuery);
    if (!equal(tamperedBefore, tamperedAfter)
      || tamperedAfter.bundle.targetCount !== 10
      || tamperedAfter.bundle.ledgerCount !== 96) {
      fail('LOCAL_REHEARSAL_WRONG_PREIMAGE_ROLLBACK_DRIFT');
    }

    const securityInvokerDriftRejected = assertCatalogDriftRejected({
      label: 'security-invoker',
      ownership,
      plan,
      stages,
      stateQuery,
      tamperSql: `ALTER VIEW public.admin_evaluation_related_rows SET (security_invoker=false);`,
    });
    const columnAclDriftRejected = assertCatalogDriftRejected({
      label: 'column-acl',
      ownership,
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT UPDATE(approved_name) ON TABLE public.restaurants TO anon;`,
    });
    const membershipInheritOptionDriftRejected = assertCatalogDriftRejected({
      label: 'membership-inherit-option',
      ownership,
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY supabase_admin;`,
      restoreSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;`,
    });
    const membershipSetOptionDriftRejected = assertCatalogDriftRejected({
      label: 'membership-set-option',
      ownership,
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY supabase_admin;`,
      restoreSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;`,
    });
    const contendedAdmissionExpiryRejected = await assertContendedExpiryRejected(record, stages, stateQuery, ownership);

    proof = {
      schemaVersion: 1,
      status: 'passed',
      environment: {
        dockerContext: DOCKER_CONTEXT,
        dockerContainer: DOCKER_CONTAINER,
        engine: template.engine,
        templateDatabase: TEMPLATE_DATABASE,
        temporaryDatabase: DATABASE,
      },
      input: template,
      ...currentBindings,
      predecessorSources: PREDECESSOR_PATHS.map(path => ({
        path,
        sha256: sha256(readFileSync(resolve(REPOSITORY_ROOT, path))),
      })),
      migrationCount: record.manifest.migrations.length,
      statementCount: record.manifest.migrations.reduce((sum, migration) => sum + migration.statementCount, 0),
      stageStatesSha256: sha256(JSON.stringify(canonical(stages))),
      stages: stages.map(summarizeStage),
      results: {
        advisoryContentionObserved: true,
        atomicCommit: true,
        atomicRollbackExact: true,
        catalogDriftStatePreserved: true,
        columnAclDriftRejected,
        compiledSqlBytes: Buffer.byteLength(plan.sql),
        compiledSqlSha256: sha256(plan.sql),
        contendedAdmissionExpiryRejected,
        contendedAdmissionExpiryStatePreserved: true,
        membershipOptionsBaseline: { inherit: true, set: true },
        membershipInheritOptionDriftRejected,
        membershipSetOptionDriftRejected,
        securityInvokerBaseline: true,
        securityInvokerDriftRejected,
        wrongFinishPreimageRejected: true,
        wrongFinishPreimageRollbackExact: true,
        terminalLedgerCount: committed.bundle.ledgerCount,
        terminalContractReady: committed.state.terminalContractReady,
      },
      sourceMutation: false,
      hostedWrites: false,
      operatingWrites: false,
    };
  } finally {
    cleanupOwnedFixtures(ownership);
  }
  proof.temporaryDatabaseDropped = true;
  proof.fixtureRolesDropped = true;
  const currentProofBytes = Buffer.from(`${JSON.stringify(canonical(proof))}\n`);
  process.stdout.write(`${JSON.stringify({
    current: {
      classification: 'current-source-verification',
      proofSha256: sha256(currentProofBytes),
      bindings: currentBindings,
      proof,
    },
    retained: retainedProof,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
