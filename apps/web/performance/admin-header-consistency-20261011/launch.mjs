import { existsSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

import { GATEWAY_ORIGIN, NEXT_PORT, SUPABASE_ORIGIN } from './loopback-transport.mjs'
import { readE2EAdminRouteBypassContract, WEB_ROOT } from './source-contract.mjs'

const PINNED_NODE = '/opt/homebrew/opt/node@24/bin/node'
export const DEVELOPMENT_DIST_DIR = '.next-admin-header-consistency-18820'
export const PRODUCTION_DIST_DIR = '.next-admin-header-build-20261012'
export const PRODUCTION_BUILD_ID = join(WEB_ROOT, PRODUCTION_DIST_DIR, 'BUILD_ID')
const SYNTHETIC_BYPASS_TOKEN = 'admin-header-consistency-synthetic-only'
const gatewayPath = join(
    WEB_ROOT,
    'performance/admin-header-consistency-20261011/fixture-gateway.mjs',
)
const nextBin = join(WEB_ROOT, 'node_modules/next/dist/bin/next')
const parentEnvironmentAllowlist = [
    'HOME',
    'LANG',
    'LC_ALL',
    'PATH',
    'SHELL',
    'TERM',
    'TMPDIR',
    'TZ',
    'USER',
]

export function parseFixtureLaunchMode(argv) {
    if (argv.length === 0) return 'development'
    if (argv.length === 1 && argv[0] === '--production') return 'production'
    throw new Error('FIXTURE_ARGUMENTS_INVALID')
}

function safeParentEnvironment(parentEnvironment) {
    return Object.fromEntries(
        parentEnvironmentAllowlist
            .filter((name) => typeof parentEnvironment[name] === 'string')
            .map((name) => [name, parentEnvironment[name]]),
    )
}

export function buildFixtureLaunchPlan(
    argv,
    contract,
    parentEnvironment = process.env,
    { productionBuildExists = existsSync(PRODUCTION_BUILD_ID) } = {},
) {
    const mode = parseFixtureLaunchMode(argv)
    if (mode === 'production' && !productionBuildExists) {
        throw new Error(`FIXTURE_PRODUCTION_BUILD_MISSING:${PRODUCTION_BUILD_ID}`)
    }

    const inheritedEnvironment = safeParentEnvironment(parentEnvironment)
    const production = mode === 'production'
    const distDir = production ? PRODUCTION_DIST_DIR : DEVELOPMENT_DIST_DIR
    const nextEnvironment = {
        ...inheritedEnvironment,
        __NEXT_PROCESSED_ENV: 'true',
        BROWSER: 'none',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
        NEXT_PUBLIC_SITE_URL: GATEWAY_ORIGIN,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-loopback-anon-key',
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ORIGIN,
        NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
        TZUDONG_NEXT_DIST_DIR: distDir,
        [contract.env.enabled]: '1',
        [contract.env.context]: contract.context,
        [contract.env.runtime]: production ? contract.productionSmoke.runtime : contract.runtime,
        [contract.env.token]: SYNTHETIC_BYPASS_TOKEN,
        ...(production
            ? {
                  NODE_ENV: 'production',
                  [contract.productionSmoke.allowEnv]: '1',
              }
            : {}),
    }
    const nextArguments = production
        ? [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(NEXT_PORT)]
        : [
              nextBin,
              'dev',
              '--webpack',
              '--hostname',
              '127.0.0.1',
              '--port',
              String(NEXT_PORT),
          ]

    return {
        mode,
        distDir,
        nextArguments,
        nextEnvironment,
        gatewayEnvironment: inheritedEnvironment,
    }
}

export function launchFixture(argv = process.argv.slice(2)) {
    if (process.versions.node.split('.')[0] !== '24') {
        throw new Error(`FIXTURE_REQUIRES_NODE_24:${process.versions.node}`)
    }
    if (realpathSync(process.execPath) !== realpathSync(PINNED_NODE)) {
        throw new Error(`FIXTURE_REQUIRES_PINNED_NODE:${PINNED_NODE}`)
    }
    if (!existsSync(nextBin)) throw new Error(`FIXTURE_NEXT_BINARY_MISSING:${nextBin}`)

    const contract = readE2EAdminRouteBypassContract()
    const plan = buildFixtureLaunchPlan(argv, contract)
    const next = spawn(PINNED_NODE, plan.nextArguments, {
        cwd: WEB_ROOT,
        env: plan.nextEnvironment,
        shell: false,
        stdio: 'inherit',
    })
    const gateway = spawn(PINNED_NODE, [gatewayPath], {
        cwd: WEB_ROOT,
        env: plan.gatewayEnvironment,
        shell: false,
        stdio: 'inherit',
    })

    process.stdout.write(
        [
            `launcher_pid=${process.pid}`,
            `next_pid=${next.pid}`,
            `gateway_pid=${gateway.pid}`,
            `fixture_origin=${GATEWAY_ORIGIN}`,
            `next_mode=${plan.mode}`,
            `next_dist_dir=${plan.distDir}`,
            'Use Ctrl-C in this terminal for teardown.',
        ].join('\n') + '\n',
    )

    let closing = false
    let exitCode = 0
    function stopChildren(code = 0) {
        if (closing) return
        closing = true
        exitCode = code
        for (const child of [gateway, next]) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        }
        const timeout = setTimeout(() => {
            for (const child of [gateway, next]) {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
            }
        }, 5_000)
        timeout.unref()
    }

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => stopChildren(0))
    }
    for (const [name, child] of [
        ['next', next],
        ['gateway', gateway],
    ]) {
        child.on('error', (error) => {
            process.stderr.write(`${name} failed to start: ${error.message}\n`)
            stopChildren(1)
        })
        child.on('exit', (code, signal) => {
            if (!closing) {
                process.stderr.write(`${name} exited unexpectedly: code=${code} signal=${signal}\n`)
                stopChildren(code || 1)
            }
            if (next.exitCode !== null || next.signalCode !== null) {
                if (gateway.exitCode !== null || gateway.signalCode !== null) {
                    process.exit(exitCode)
                }
            }
        })
    }
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (launchedDirectly) launchFixture()
