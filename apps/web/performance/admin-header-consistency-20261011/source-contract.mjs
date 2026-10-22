import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const BYPASS_SOURCE_PATH = fileURLToPath(
    new URL('../../lib/e2e-admin-route-bypass.ts', import.meta.url),
)

function requiredMatch(source, expression, label) {
    const value = source.match(expression)?.[1]
    if (!value) {
        throw new Error(`FIXTURE_SOURCE_CONTRACT_MISSING:${label}`)
    }
    return value
}

// Node 24 cannot import this TypeScript source directly. Parse the exported
// literals so the fixture uses the application's current contract at launch.
export function readE2EAdminRouteBypassContract() {
    const source = readFileSync(BYPASS_SOURCE_PATH, 'utf8')
    const envObject = requiredMatch(
        source,
        /export const E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS\s*=\s*\{([\s\S]*?)\}\s*as const/,
        'env-keys',
    )
    const envKey = (name) =>
        requiredMatch(envObject, new RegExp(`${name}:\\s*'([^']+)'`), `env.${name}`)
    const exportedString = (name) =>
        requiredMatch(source, new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`), name)

    return Object.freeze({
        env: Object.freeze({
            enabled: envKey('enabled'),
            context: envKey('context'),
            runtime: envKey('runtime'),
            token: envKey('token'),
        }),
        context: exportedString('E2E_ADMIN_ROUTE_BYPASS_CONTEXT'),
        runtime: exportedString('E2E_ADMIN_ROUTE_BYPASS_RUNTIME'),
        productionSmoke: Object.freeze({
            runtime: exportedString('E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_RUNTIME'),
            allowEnv: exportedString('E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_ENV'),
        }),
        header: exportedString('E2E_ADMIN_ROUTE_BYPASS_HEADER'),
        tokenHeader: exportedString('E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER'),
    })
}
