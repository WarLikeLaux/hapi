import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectOpencodeQuota } from './opencode'

const NOW_SEC = 1_700_000_000
let dataHome: string

beforeEach(() => {
    dataHome = mkdtempSync(join(tmpdir(), 'hapi-opencode-quota-'))
    mkdirSync(join(dataHome, 'opencode'))
    writeFileSync(join(dataHome, 'opencode', 'auth.json'), JSON.stringify({
        'opencode-go': { type: 'api', key: 'test-go-key' }
    }))
})

afterEach(() => rmSync(dataHome, { recursive: true, force: true }))

describe('collectOpencodeQuota', () => {
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
        [401, 'auth_expired'],
        [403, 'unavailable'],
        [503, 'unavailable']
    ])('reports HTTP %i as %s without exposing the response body', async (status, reason) => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream detail', { status }))
        expect(await collectOpencodeQuota(NOW_SEC, { XDG_DATA_HOME: dataHome }, fetchImpl)).toEqual({
            kind: 'unavailable', source: 'opencode:monthly', reason, detail: `HTTP ${status}`
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
