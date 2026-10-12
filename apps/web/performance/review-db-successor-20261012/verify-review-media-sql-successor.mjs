#!/usr/bin/env node

/**
 * Local-only PostgreSQL 17.6 rehearsal for the held eleven-stage successor.
 *
 * The harness clones the existing schema-only ranking_clone template into one
 * fixed, owned database name. It refuses a reused target, never connects to a
 * hosted endpoint, and drops the owned database before writing its proof.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const DOCKER_CONTEXT = process.env.TZUDONG_REHEARSAL_DOCKER_CONTEXT || 'colima-tzudong-catalog-20261007';
const DOCKER_CONTAINER = process.env.TZUDONG_REHEARSAL_DOCKER_CONTAINER || 'tzudong-ranking-clone-20261008';
const TEMPLATE_DATABASE = 'ranking_clone';
const DATABASE = 'review_successor_local_20261012_v1';
const FIXTURE_PASSWORD = 'fixture-only';
const FIXTURE_PARENT_ROLE = 'review_successor_fixture_parent_20261012';
const FIXTURE_MEMBER_ROLE = 'review_successor_fixture_member_20261012';
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

function createOwnedDatabase() {
  const exists = scalar('postgres', `SELECT count(*) FROM pg_database WHERE datname=${quote(DATABASE)};`, 'supabase_admin');
  if (exists !== '0') fail('LOCAL_REHEARSAL_TARGET_ALREADY_EXISTS');
  psql('postgres', `CREATE DATABASE ${DATABASE} TEMPLATE ${TEMPLATE_DATABASE} OWNER postgres;`, { actor: 'supabase_admin' });
  PREDECESSOR_PATHS.forEach((path, index) => {
    try {
      psql(DATABASE, readFileSync(resolve(REPOSITORY_ROOT, path)));
    } catch (error) {
      fail('LOCAL_REHEARSAL_PREDECESSOR_FAILED', `${index + 1}:${error.message}`);
    }
  });
  psql(DATABASE, fixtureSql());
}

function dropOwnedDatabase() {
  const exists = scalar('postgres', `SELECT count(*) FROM pg_database WHERE datname=${quote(DATABASE)};`, 'supabase_admin');
  if (exists === '1') {
    psql('postgres', `DROP DATABASE ${DATABASE} WITH (FORCE);`, { actor: 'supabase_admin' });
  } else if (exists !== '0') {
    fail('LOCAL_REHEARSAL_TARGET_CARDINALITY_INVALID');
  }
}

function resetOwnedDatabase() {
  dropOwnedDatabase();
  createOwnedDatabase();
}

function createFixtureMembership() {
  const existing = scalar('postgres', `SELECT count(*) FROM pg_roles WHERE rolname IN(${quote(FIXTURE_PARENT_ROLE)},${quote(FIXTURE_MEMBER_ROLE)});`, 'supabase_admin');
  if (existing !== '0') fail('LOCAL_REHEARSAL_FIXTURE_ROLE_EXISTS');
  psql('postgres', `
BEGIN;
CREATE ROLE ${FIXTURE_PARENT_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${FIXTURE_MEMBER_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE}
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;
COMMIT;
`, { actor: 'supabase_admin' });
}

function dropFixtureMembership() {
  const existing = scalar('postgres', `SELECT count(*) FROM pg_roles WHERE rolname IN(${quote(FIXTURE_PARENT_ROLE)},${quote(FIXTURE_MEMBER_ROLE)});`, 'supabase_admin');
  if (existing === '0') return;
  if (existing !== '2') fail('LOCAL_REHEARSAL_FIXTURE_ROLE_CARDINALITY_INVALID');
  psql('postgres', `
BEGIN;
REVOKE ${FIXTURE_PARENT_ROLE} FROM ${FIXTURE_MEMBER_ROLE} GRANTED BY supabase_admin;
DROP ROLE ${FIXTURE_MEMBER_ROLE};
DROP ROLE ${FIXTURE_PARENT_ROLE};
COMMIT;
`, { actor: 'supabase_admin' });
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

function assertCatalogDriftRejected({ label, plan, stages, stateQuery, tamperSql, restoreSql = null }) {
  resetOwnedDatabase();
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

async function assertContendedExpiryRejected(record, stages, stateQuery) {
  resetOwnedDatabase();
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

async function run() {
  if (existsSync(OUTPUT_PATH)) fail('LOCAL_REHEARSAL_PROOF_EXISTS');
  const manifestBytes = readFileSync(resolve(REPOSITORY_ROOT, '.github/review-media-sql-successor.v1.json'));
  const record = loadSuccessorManifest();
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

  let created = false;
  let fixtureMembershipCreated = false;
  let proof;
  try {
    createFixtureMembership();
    fixtureMembershipCreated = true;
    createOwnedDatabase();
    created = true;
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

    resetOwnedDatabase();
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

    resetOwnedDatabase();
    const rollback = psql(DATABASE, `${plan.sql}\nDO $forced$ BEGIN RAISE EXCEPTION 'LOCAL_FORCED_ROLLBACK'; END $forced$;\n`, {
      singleTransaction: true,
      allowFailure: true,
    });
    if (rollback.status === 0 || !/LOCAL_FORCED_ROLLBACK/.test(rollback.stderr)) {
      fail('LOCAL_REHEARSAL_FORCED_ROLLBACK_MISSING');
    }
    const rolledBack = readState(DATABASE, stateQuery);
    if (!equal(rolledBack, stages[0])) fail('LOCAL_REHEARSAL_ROLLBACK_DRIFT');

    resetOwnedDatabase();
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
      plan,
      stages,
      stateQuery,
      tamperSql: `ALTER VIEW public.admin_evaluation_related_rows SET (security_invoker=false);`,
    });
    const columnAclDriftRejected = assertCatalogDriftRejected({
      label: 'column-acl',
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT UPDATE(approved_name) ON TABLE public.restaurants TO anon;`,
    });
    const membershipInheritOptionDriftRejected = assertCatalogDriftRejected({
      label: 'membership-inherit-option',
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY supabase_admin;`,
      restoreSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;`,
    });
    const membershipSetOptionDriftRejected = assertCatalogDriftRejected({
      label: 'membership-set-option',
      plan,
      stages,
      stateQuery,
      tamperSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY supabase_admin;`,
      restoreSql: `GRANT ${FIXTURE_PARENT_ROLE} TO ${FIXTURE_MEMBER_ROLE} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY supabase_admin;`,
    });
    const contendedAdmissionExpiryRejected = await assertContendedExpiryRejected(record, stages, stateQuery);

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
      manifestSha256: sha256(manifestBytes),
      rehearsalHarnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      sourceRoot: record.manifest.sourceRoot,
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
    if (created) dropOwnedDatabase();
    if (fixtureMembershipCreated) dropFixtureMembership();
  }
  proof.temporaryDatabaseDropped = true;
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: proof.status,
    migrationCount: proof.migrationCount,
    statementCount: proof.statementCount,
    atomicCommit: proof.results.atomicCommit,
    atomicRollbackExact: proof.results.atomicRollbackExact,
    catalogDriftRejected: proof.results.securityInvokerDriftRejected
      && proof.results.columnAclDriftRejected
      && proof.results.membershipInheritOptionDriftRejected
      && proof.results.membershipSetOptionDriftRejected,
    contendedAdmissionExpiryRejected: proof.results.contendedAdmissionExpiryRejected,
    wrongFinishPreimageRejected: proof.results.wrongFinishPreimageRejected,
    terminalLedgerCount: proof.results.terminalLedgerCount,
    temporaryDatabaseDropped: proof.temporaryDatabaseDropped,
  })}\n`);
}

await run();
