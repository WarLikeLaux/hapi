import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

type ConsoleAccount = { token: string; expiresAt: number | null; orgId: string }
type Auth = { kind: 'api'; key: string } | { kind: 'console'; key: string; orgId: string }
type AuthFailure = { kind: 'unavailable'; detail: string }
const SIGN_IN_REQUIRED: AuthFailure = { kind: 'unavailable', detail: 'Console sign-in required' }

function dataDir(env: NodeJS.ProcessEnv): string {
    return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')
}

/** Read only the selected Console account; never copy or rotate refresh tokens. */
function readConsoleAccount(env: NodeJS.ProcessEnv): ConsoleAccount | AuthFailure | null {
    const override = env.OPENCODE_DB
    if (override === ':memory:') return null
    const dbPath = override
        ? isAbsolute(override) ? override : join(dataDir(env), override)
        : join(dataDir(env), 'opencode.db')
    if (!existsSync(dbPath)) return null
    let db: DatabaseSync | undefined
    try {
        db = new DatabaseSync(dbPath, { readOnly: true })
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('account', 'account_state')").all()
        if (tables.length !== 2) return null
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
        return { kind: 'unavailable', detail: 'Could not read Console credentials' }
    } finally {
        db?.close()
    }
}

/** Console connection takes precedence over provider keys, as in OpenCode. */
export async function resolveOpencodeQuotaAuth(nowSec: number, env: NodeJS.ProcessEnv): Promise<Auth | AuthFailure | null> {
    let account = readConsoleAccount(env)
    if (account && 'kind' in account) return account
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
            account = readConsoleAccount(env)
            if (!account || 'kind' in account) return account ?? SIGN_IN_REQUIRED
            if (account.expiresAt === null || account.expiresAt <= nowSec * 1000) return SIGN_IN_REQUIRED
        }
        return { kind: 'console', key: account.token, orgId: account.orgId }
    }

    try {
        const auth = JSON.parse(readFileSync(join(dataDir(env), 'auth.json'), 'utf8'))
        const entry = auth?.['opencode-go']
        const key = entry?.type === 'api' && typeof entry.key === 'string' ? entry.key.trim() : ''
        return key ? { kind: 'api', key } : null
    } catch {
        return null
    }
}
