import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    MINIMAX_5H_SOURCE,
    MINIMAX_WEEKLY_SOURCE,
    collectMinimaxQuotas,
    minimaxBaseUrl,
    parseMinimaxQuotaResponse,
    readMinimaxCredentials,
    resetMinimaxAuthCache,
    type MinimaxAuthPaths
} from './minimax'

const NOW_SEC = 1_700_000_000

const SAMPLE_PAYLOAD = {
    model_remains: [
        {
            model_name: 'general',
            current_interval_status: 1,
            current_interval_remaining_percent: 99,
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            end_time: (NOW_SEC + 5 * 3_600) * 1000,
            current_weekly_status: 1,
            current_weekly_remaining_percent: 66,
            weekly_end_time: (NOW_SEC + 7 * 24 * 3_600) * 1000
        }
    ],
    base_resp: { status_code: 0 }
}

describe('minimaxBaseUrl', () => {
    it('maps regions to their quota hosts', () => {
        expect(minimaxBaseUrl('en')).toBe('https://platform.minimax.io')
        expect(minimaxBaseUrl('cn')).toBe('https://www.minimaxi.com')
    })

    it('falls back to the international host for unknown regions', () => {
        expect(minimaxBaseUrl('jp')).toBe('https://platform.minimax.io')
    })
})

describe('parseMinimaxQuotaResponse', () => {
    it('parses 5h and weekly windows and flips remaining to spent', () => {
        expect(parseMinimaxQuotaResponse(SAMPLE_PAYLOAD, NOW_SEC)).toEqual([
            {
                source: MINIMAX_5H_SOURCE,
                usedPercent: 1,
                resetsAt: NOW_SEC + 5 * 3_600,
                measuredAt: NOW_SEC
            },
            {
                source: MINIMAX_WEEKLY_SOURCE,
                usedPercent: 34,
                resetsAt: NOW_SEC + 7 * 24 * 3_600,
                measuredAt: NOW_SEC
            }
        ])
    })

    it('falls back to the count ratio when the percent is absent', () => {
        const payload = {
            model_remains: [{
                model_name: 'general',
                current_interval_total_count: 3,
                current_interval_usage_count: 2
            }]
        }
        const windows = parseMinimaxQuotaResponse(payload, NOW_SEC)
        expect(windows).toHaveLength(1)
        expect(windows?.[0]).toMatchObject({
            source: MINIMAX_5H_SOURCE,
            resetsAt: null,
            measuredAt: NOW_SEC
        })
        expect(windows?.[0]?.usedPercent).toBeCloseTo(33.33, 1)
    })

    it('treats status 3 as an unburnt unlimited window', () => {
        const payload = {
            model_remains: [{
                model_name: 'general',
                current_interval_status: 3,
                current_weekly_status: 3
            }]
        }
        expect(parseMinimaxQuotaResponse(payload, NOW_SEC)).toEqual([
            { source: MINIMAX_5H_SOURCE, usedPercent: 0, resetsAt: null, measuredAt: NOW_SEC },
            { source: MINIMAX_WEEKLY_SOURCE, usedPercent: 0, resetsAt: null, measuredAt: NOW_SEC }
        ])
    })

    it('prefers the general row over the first row and ignores other rows', () => {
        const payload = {
            model_remains: [
                { model_name: 'video', current_interval_remaining_percent: 10 },
                { model_name: 'general', current_interval_remaining_percent: 20 }
            ]
        }
        // The general row has no weekly fields, so only the 5h window parses.
        expect(parseMinimaxQuotaResponse(payload, NOW_SEC)).toEqual([
            { source: MINIMAX_5H_SOURCE, usedPercent: 80, resetsAt: null, measuredAt: NOW_SEC }
        ])
    })

    it('returns null for malformed payloads', () => {
        expect(parseMinimaxQuotaResponse(null, NOW_SEC)).toBeNull()
        expect(parseMinimaxQuotaResponse('nope', NOW_SEC)).toBeNull()
        expect(parseMinimaxQuotaResponse({}, NOW_SEC)).toBeNull()
        expect(parseMinimaxQuotaResponse({ model_remains: [] }, NOW_SEC)).toBeNull()
        expect(parseMinimaxQuotaResponse({ model_remains: [{}] }, NOW_SEC)).toBeNull()
    })
})

describe('readMinimaxCredentials', () => {
    const dirs: string[] = []

    function tempPaths(files: { region?: unknown; auth?: unknown }): MinimaxAuthPaths {
        const dir = mkdtempSync(join(tmpdir(), 'minimax-quota-'))
        dirs.push(dir)
        const paths: MinimaxAuthPaths = {
            regionFile: join(dir, 'mcode-region.json'),
            authFile: (region: string) => join(dir, 'auth', region, 'auth.json')
        }
        if (files.region !== undefined) {
            writeFileSync(paths.regionFile, JSON.stringify(files.region))
        }
        if (files.auth !== undefined) {
            mkdirSync(join(dir, 'auth', 'en'), { recursive: true })
            mkdirSync(join(dir, 'auth', 'cn'), { recursive: true })
            writeFileSync(paths.authFile('en'), JSON.stringify(files.auth))
            writeFileSync(paths.authFile('cn'), JSON.stringify(files.auth))
        }
        return paths
    }

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    })

    it('reads the token from the configured region', () => {
        const paths = tempPaths({
            region: { regions: { prod: 'cn' } },
            auth: { records: { rec: { accessToken: ' tok-cn ', expiresAtMs: 5 } } }
        })
        expect(readMinimaxCredentials(paths)).toEqual({ region: 'cn', accessToken: 'tok-cn' })
    })

    it('picks the record with the latest expiry', () => {
        const paths = tempPaths({
            auth: {
                records: {
                    old: { accessToken: 'tok-old', expiresAtMs: 1 },
                    new: { accessToken: 'tok-new', expiresAtMs: 9 }
                }
            }
        })
        expect(readMinimaxCredentials(paths)?.accessToken).toBe('tok-new')
    })

    it('returns null without files or usable records', () => {
        const missing = tempPaths({})
        expect(readMinimaxCredentials(missing)).toBeNull()

        const empty = tempPaths({ auth: { records: { rec: { accessToken: '' } } } })
        expect(readMinimaxCredentials(empty)).toBeNull()

        const broken = tempPaths({ auth: 'not-an-object' })
        expect(readMinimaxCredentials(broken)).toBeNull()
    })
})

/**
 * Quota-collector behavior on auth failures. Once any good snapshot is cached,
 * the collector silently replays it on every 401 — the limits panel keeps
 * showing last-known usage with a staleness indicator instead of flashing a
 * red "Authentication expired" banner. Without a cached snapshot there is
 * nothing to replay, so the very first 401 surfaces `auth_expired`.
 */
describe('collectMinimaxQuotas replay-on-401', () => {
    const fetchMock = vi.fn<typeof fetch>()
    let paths: MinimaxAuthPaths

    beforeEach(() => {
        resetMinimaxAuthCache()
        fetchMock.mockReset()
        const dir = mkdtempSync(join(tmpdir(), 'minimax-collect-'))
        paths = {
            regionFile: join(dir, 'mcode-region.json'),
            authFile: () => join(dir, 'auth.json')
        }
        writeFileSync(paths.authFile('en'), JSON.stringify({
            records: { r: { accessToken: 'tok', expiresAtMs: 9_999_999_999 } }
        }))
    })

    afterEach(() => {
        rmSync(join(paths.authFile('en'), '..'), { recursive: true, force: true })
    })

    function okResponse(): Response {
        return new Response(JSON.stringify(SAMPLE_PAYLOAD), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    }

    function authExpiredResponse(): Response {
        return new Response('expired', { status: 401 })
    }

    it('caches windows on a successful poll so they survive the next 401', async () => {
        fetchMock.mockResolvedValueOnce(okResponse())
        fetchMock.mockResolvedValueOnce(authExpiredResponse())

        const first = await collectMinimaxQuotas(NOW_SEC, paths, fetchMock as unknown as typeof fetch)
        expect(first.kind).toBe('ok')

        const second = await collectMinimaxQuotas(NOW_SEC + 30, paths, fetchMock as unknown as typeof fetch)
        expect(second.kind).toBe('ok')
        if (second.kind !== 'ok') return
        expect(second.windows).toEqual(first.kind === 'ok' ? first.windows : [])
    })

    it('replays the cached snapshot on every consecutive 401 — no threshold trips an error', async () => {
        fetchMock.mockResolvedValueOnce(okResponse())
        // Many strikes in a row — none of them should ever surface auth_expired
        // once the cache has anything to replay.
        for (let i = 0; i < 50; i++) {
            fetchMock.mockResolvedValueOnce(authExpiredResponse())
        }

        const first = await collectMinimaxQuotas(NOW_SEC, paths, fetchMock as unknown as typeof fetch)
        expect(first.kind).toBe('ok')
        const cachedWindows = first.kind === 'ok' ? first.windows : []

        for (let i = 0; i < 50; i++) {
            const result = await collectMinimaxQuotas(NOW_SEC + i + 1, paths, fetchMock as unknown as typeof fetch)
            expect(result.kind).toBe('ok')
            if (result.kind !== 'ok') return
            expect(result.windows).toEqual(cachedWindows)
        }
    })

    it('refreshes the cached windows as soon as a poll succeeds again', async () => {
        fetchMock.mockResolvedValueOnce(okResponse())
        fetchMock.mockResolvedValueOnce(authExpiredResponse())
        fetchMock.mockResolvedValueOnce(authExpiredResponse())
        fetchMock.mockResolvedValueOnce(okResponse())

        const calls: Array<Awaited<ReturnType<typeof collectMinimaxQuotas>>> = []
        for (let i = 0; i < 4; i++) {
            calls.push(await collectMinimaxQuotas(NOW_SEC + i, paths, fetchMock as unknown as typeof fetch))
        }

        // After the second success the cache reflects that response, so the
        // measuredAt moves forward — the third ok response is the new truth.
        expect(calls[0]!.kind).toBe('ok')
        expect(calls[1]!.kind).toBe('ok')
        expect(calls[2]!.kind).toBe('ok')
        expect(calls[3]!.kind).toBe('ok')
        if (calls[3]!.kind !== 'ok' || calls[0]!.kind !== 'ok') return
        expect(calls[3]!.windows[0]!.measuredAt).toBe(NOW_SEC + 3)
        expect(calls[0]!.windows[0]!.measuredAt).toBe(NOW_SEC)
    })

    it('reports auth_expired on the very first poll when no snapshot has been cached yet', async () => {
        fetchMock.mockResolvedValueOnce(authExpiredResponse())
        const result = await collectMinimaxQuotas(NOW_SEC, paths, fetchMock as unknown as typeof fetch)
        expect(result.kind).toBe('unavailable')
        if (result.kind !== 'unavailable') return
        expect(result.reason).toBe('auth_expired')
        expect(result.source).toBe(MINIMAX_5H_SOURCE)
        expect(result.detail).toBe('HTTP 401')
    })

    it('surfaces non-401 transport errors as unavailable without disturbing the cache', async () => {
        fetchMock.mockResolvedValueOnce(okResponse())
        fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 }))
        fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 }))

        const first = await collectMinimaxQuotas(NOW_SEC, paths, fetchMock as unknown as typeof fetch)
        expect(first.kind).toBe('ok')
        const cachedWindows = first.kind === 'ok' ? first.windows : []

        // 503s must NOT be mistaken for auth failures — the collector surfaces
        // them as plain unavailable. Once the network recovers, the cache
        // returns and replays cleanly.
        const transportError = await collectMinimaxQuotas(NOW_SEC + 1, paths, fetchMock as unknown as typeof fetch)
        expect(transportError.kind).toBe('unavailable')
        if (transportError.kind !== 'unavailable') return
        expect(transportError.reason).toBe('unavailable')
        expect(transportError.source).toBe(MINIMAX_5H_SOURCE)
        expect(transportError.detail).toContain('503')

        // Consume the second queued 503 the same way — it must not poison the
        // cache or the replay path either.
        const transportErrorRepeat = await collectMinimaxQuotas(NOW_SEC + 2, paths, fetchMock as unknown as typeof fetch)
        expect(transportErrorRepeat.kind).toBe('unavailable')

        // The cache is intact and the next 401 still replays it.
        fetchMock.mockResolvedValueOnce(authExpiredResponse())
        const replay = await collectMinimaxQuotas(NOW_SEC + 3, paths, fetchMock as unknown as typeof fetch)
        expect(replay.kind).toBe('ok')
        if (replay.kind !== 'ok') return
        expect(replay.windows).toEqual(cachedWindows)
    })
})