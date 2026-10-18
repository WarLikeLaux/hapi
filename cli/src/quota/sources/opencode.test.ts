import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectOpencodeQuota } from './opencode'

const NOW_SEC = 1_700_000_000
const refreshConsole = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: refreshConsole }))
let dataHome: string

function consoleAccount(expiresAt = (NOW_SEC + 3600) * 1000, key = 'console-access') {
    const db = new DatabaseSync(join(dataHome, 'opencode', 'opencode.db'))
    db.exec(`CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, url TEXT, access_token TEXT, token_expiry INTEGER);
        CREATE TABLE IF NOT EXISTS account_state (id INTEGER PRIMARY KEY, active_account_id TEXT, active_org_id TEXT);`)
    db.prepare('INSERT OR REPLACE INTO account VALUES (?, ?, ?, ?)').run('account-1', 'https://opencode.ai/console', key, expiresAt)
    db.prepare('INSERT OR REPLACE INTO account_state VALUES (?, ?, ?)').run(1, 'account-1', 'org-go')
    db.close()
}

beforeEach(() => {
    refreshConsole.mockReset()
    dataHome = mkdtempSync(join(tmpdir(), 'hapi-opencode-quota-'))
    mkdirSync(join(dataHome, 'opencode'))
    writeFileSync(join(dataHome, 'opencode', 'auth.json'), JSON.stringify({
        'opencode-go': { type: 'api', key: 'test-go-key' }
    }))
})

afterEach(() => rmSync(dataHome, { recursive: true, force: true }))

describe('collectOpencodeQuota', () => {
    it('uses the active Console account and its workspace instead of a stale legacy API key', async () => {
        consoleAccount()
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
            const headers = init?.headers as Record<string, string>
            if (headers.Authorization !== 'Bearer console-access' || headers['x-opencode-org-id'] !== 'org-go') {
                return new Response(JSON.stringify({ error: { code: 'api_key_expired' } }), { status: 401 })
            }
            return new Response(JSON.stringify({ usage: { monthly: { status: 'ok', percent: 8 } } }))
        })
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'ok', windows: [{ source: 'opencode:monthly', usedPercent: 8, resetsAt: null, measuredAt: NOW_SEC }]
        })
        expect(refreshConsole).not.toHaveBeenCalled()
    })

    it.each([-60, 120])('delegates Console refresh to OpenCode with %i seconds left and rereads the credential', async (remaining) => {
        consoleAccount((NOW_SEC + remaining) * 1000)
        refreshConsole.mockImplementation((_cmd, _args, _opts, callback) => {
            consoleAccount((NOW_SEC + 3600) * 1000, 'refreshed-console-access')
            callback(null, '', '')
        })
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
            if ((init?.headers as Record<string, string>).Authorization !== 'Bearer refreshed-console-access') {
                return new Response(null, { status: 401 })
            }
            return new Response(JSON.stringify({ usage: { monthly: { status: 'ok', percent: 8 } } }))
        })
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toMatchObject({ kind: 'ok' })
        expect(refreshConsole).toHaveBeenCalledWith('opencode', ['console', 'orgs'], expect.objectContaining({
            env: expect.objectContaining({ XDG_DATA_HOME: dataHome })
        }), expect.any(Function))
    })

    it('reports a Console recovery failure without exposing native errors or falling back to another account', async () => {
        consoleAccount((NOW_SEC - 60) * 1000)
        refreshConsole.mockImplementation((_cmd, _args, _opts, callback) => callback(new Error('secret refresh failure')))
        const fetchImpl = vi.fn<typeof fetch>()
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'unavailable', detail: 'Console refresh failed'
        })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('keeps a rejected Console connection separate from an expired API key and does not use another account', async () => {
        consoleAccount()
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            error: { code: 'api_key_expired', message: 'private upstream detail' }
        }), { status: 401 }))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'unavailable', detail: 'Console sign-in required'
        })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('requires sign-in if OpenCode completes without renewing an expired Console token', async () => {
        consoleAccount((NOW_SEC - 60) * 1000)
        refreshConsole.mockImplementation((_cmd, _args, _opts, callback) => callback(null, '', ''))
        const fetchImpl = vi.fn<typeof fetch>()
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'unavailable', detail: 'Console sign-in required'
        })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('does not send a custom Console server credential to the official Go service', async () => {
        consoleAccount()
        const db = new DatabaseSync(join(dataHome, 'opencode', 'opencode.db'))
        db.prepare('UPDATE account SET url = ?').run('https://example.invalid/console')
        db.close()
        const fetchImpl = vi.fn<typeof fetch>()
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'unavailable', detail: 'Unsupported Console server'
        })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('reports monthly spend and period end using the local Go credential', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            usage: {
                rolling: { status: 'ok', percent: 70, resetsAt: '2026-10-09T22:48:49.985Z' },
                weekly: { status: 'ok', percent: 10, resetsAt: '2026-10-12T00:00:00.000Z' },
                monthly: { status: 'ok', percent: 2, resetsAt: '2026-10-21T17:17:06.000Z' }
            }
        })))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'ok',
            windows: [{ source: 'opencode:monthly', usedPercent: 2, resetsAt: 1792603026, measuredAt: NOW_SEC }]
        })
        expect(fetchImpl).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/usage', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer test-go-key' })
        }))
    })

    it('skips machines without a Go credential without making a request', async () => {
        writeFileSync(join(dataHome, 'opencode', 'auth.json'), JSON.stringify({
            opencode: { type: 'api', key: 'zen-only-key' }
        }))
        const fetchImpl = vi.fn<typeof fetch>()
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({ kind: 'skipped' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it.each([
        [401, 'unavailable'],
        [403, 'unavailable'],
        [503, 'unavailable']
    ])('reports HTTP %i as %s without exposing the response body', async (status, reason) => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream detail', { status }))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason, detail: `HTTP ${status}`
        })
    })

    it('recognizes confirmed key expiry without forwarding upstream messages', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            error: { type: 'authentication_error', code: 'api_key_expired', message: 'private upstream detail' }
        }), { status: 401 }))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'auth_expired', detail: 'HTTP 401'
        })
    })

    it('does not mistake an unrecognized auth failure for expiry', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            error: { type: 'authentication_error', code: 'invalid_api_key', message: 'private upstream detail' }
        }), { status: 401 }))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason: 'unavailable', detail: 'HTTP 401'
        })
    })

    it('recovers on the next poll after the local key is replaced', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
            if ((init?.headers as Record<string, string>).Authorization === 'Bearer replacement-key') {
                return new Response(JSON.stringify({ usage: { monthly: { status: 'ok', percent: 23 } } }))
            }
            return new Response(JSON.stringify({ error: { code: 'api_key_expired' } }), { status: 401 })
        })
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toMatchObject({
            kind: 'unavailable', reason: 'auth_expired'
        })
        writeFileSync(join(dataHome, 'opencode', 'auth.json'), JSON.stringify({
            'opencode-go': { type: 'api', key: 'replacement-key' }
        }))
        expect(await collectOpencodeQuota(NOW_SEC + 300, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'ok', windows: [{ source: 'opencode:monthly', usedPercent: 23, resetsAt: null, measuredAt: NOW_SEC + 300 }]
        })
    })

    it.each([null, {}, { usage: { monthly: { status: 'ok' } } }, { usage: { monthly: { status: 'ok', percent: '2' } } }])(
        'does not report an unused quota for malformed usage %j', async (payload) => {
            const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)))
            expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toMatchObject({
                kind: 'unavailable', source: 'opencode:monthly'
            })
        }
    )

    it('keeps a rate-limited window readable when its reset date is invalid', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            usage: { monthly: { status: 'rate-limited', percent: 101, resetsAt: 'invalid' } }
        })))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'ok', windows: [{ source: 'opencode:monthly', usedPercent: 100, resetsAt: null, measuredAt: NOW_SEC }]
        })
    })
})
