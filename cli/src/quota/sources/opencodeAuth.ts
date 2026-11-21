import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

type ConsoleAccount = { token: string; expiresAt: number | null; orgId: string }
type Auth = { kind: 'api'; key: string } | { kind: 'console'; key: string; orgId: string }
type AuthFailure = { kind: 'unavailable'; detail: string }
const SIGN_IN_REQUIRED: AuthFailure = { kind: 'unavailable', detail: 'Console sign-in required' }

function dataDir(env: NodeJS.ProcessEnv): string {
    return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')
}

async function resolveDatabasePath(env: NodeJS.ProcessEnv, dataPath: string): Promise<string> {
    // The executable may set its own data directory in a wrapper, independently of the runner.
    try {
        const { stdout } = await promisify(execFile)('opencode', ['debug', 'paths', 'db'], {
            env: { ...process.env, ...env },
            timeout: 5_000,
            maxBuffer: 16 * 1024,
            windowsHide: true
        })
        const path = stdout.trim()
        if (path === ':memory:' || (isAbsolute(path) && !/[\r\n]/.test(path))) return path
    } catch {
        // Older installations may not support querying one path.
    }

    const override = env.OPENCODE_DB
    if (override === ':memory:' || (override && isAbsolute(override))) return override
    return join(dataPath, override || 'opencode.db')
}

function readDatabaseAuth(dbPath: string): ConsoleAccount | Auth | AuthFailure | { kind: 'no_go_key' } | null {
    if (!existsSync(dbPath)) return null
    let db: DatabaseSync | undefined
    try {
        db = new DatabaseSync(dbPath, { readOnly: true })
        const tables = new Set(db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('credential', 'account', 'account_state')"
        ).all().map((row) => row.name))
        if (tables.has('credential')) {
            const rows = db.prepare("SELECT value FROM credential WHERE integration_id = 'opencode-go' AND active = 1").all()
            if (rows.length === 0) return { kind: 'no_go_key' }
            if (rows.length !== 1 || typeof rows[0].value !== 'string') {
                return { kind: 'unavailable', detail: 'Could not read active OpenCode Go credential' }
            }
            const credential = JSON.parse(rows[0].value)
            const key = credential?.type === 'key' && typeof credential.key === 'string' ? credential.key.trim() : ''
            return key ? { kind: 'api', key } : { kind: 'no_go_key' }
        }
        if (!tables.has('account') || !tables.has('account_state')) return null
        // Read only the selected legacy Console account. OpenCode owns token rotation.
        const row = db.prepare(`SELECT a.url AS server, a.access_token AS token,
            a.token_expiry AS expiresAt, s.active_org_id AS orgId
            FROM account a JOIN account_state s ON a.id = s.active_account_id WHERE s.id = 1`).get()
        if (!row) return null
        if (row.server !== 'https://opencode.ai/console' && row.server !== 'https://opencode.ai/console/') {
            return { kind: 'unavailable', detail: 'Unsupported Console server' }
        }
        if (typeof row.token !== 'string' || !row.token || typeof row.orgId !== 'string' || !row.orgId) {
            return SIGN_IN_REQUIRED
        }
        return {
            token: row.token,
            orgId: row.orgId,
            expiresAt: typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt) ? row.expiresAt : null
        }
    } catch {
        return { kind: 'unavailable', detail: 'Could not read OpenCode credentials' }
    } finally {
        db?.close()
    }
}

export async function resolveOpencodeQuotaAuth(nowSec: number, env: NodeJS.ProcessEnv): Promise<Auth | AuthFailure | null> {
    const dataPath = dataDir(env)
    const dbPath = await resolveDatabasePath(env, dataPath)
    let account = readDatabaseAuth(dbPath)
    if (account && 'kind' in account) return account.kind === 'no_go_key' ? null : account
    if (account) {
        // Match OpenCode's five-minute eager refresh threshold. Let its own
        // account service persist rotating tokens; HAPI must not refresh a
        // copied token or independently write OpenCode's database.
        if (account.expiresAt === null || account.expiresAt <= (nowSec + 300) * 1000) {
            try {
                await promisify(execFile)('opencode', ['console', 'orgs'], {
                    env: { ...process.env, ...env },
                    timeout: 20_000,
                    maxBuffer: 256 * 1024,
                    windowsHide: true
                })
            } catch {
                return { kind: 'unavailable', detail: 'Console refresh failed' }
            }
            account = readDatabaseAuth(dbPath)
            if (!account || 'kind' in account) {
                return account?.kind === 'unavailable' ? account : SIGN_IN_REQUIRED
            }
            if (account.expiresAt === null || account.expiresAt <= nowSec * 1000) return SIGN_IN_REQUIRED
        }
        return { kind: 'console', key: account.token, orgId: account.orgId }
    }

    try {
        const legacyDataPath = env.OPENCODE_DB || dbPath === ':memory:' ? dataPath : dirname(dbPath)
        const auth = JSON.parse(readFileSync(join(legacyDataPath, 'auth.json'), 'utf8'))
        const entry = auth?.['opencode-go']
        const key = entry?.type === 'api' && typeof entry.key === 'string' ? entry.key.trim() : ''
        return key ? { kind: 'api', key } : null
    } catch {
        return null
    }
}
