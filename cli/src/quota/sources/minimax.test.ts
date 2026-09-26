import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    MINIMAX_5H_SOURCE,
    MINIMAX_VIDEO_SOURCE,
    MINIMAX_WEEKLY_SOURCE,
    minimaxBaseUrl,
    parseMinimaxQuotaResponse,
    readMinimaxCredentials,
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
        },
        {
            model_name: 'video-01',
            current_interval_status: 1,
            current_interval_remaining_percent: 66,
            current_interval_total_count: 3,
            current_interval_usage_count: 2,
            end_time: (NOW_SEC + 3_600) * 1000
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
    it('parses 5h, weekly and video windows and flips remaining to spent', () => {
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
            },
            {
                source: MINIMAX_VIDEO_SOURCE,
                usedPercent: 34,
                resetsAt: NOW_SEC + 3_600,
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

    it('prefers the general row over the first row', () => {
        const payload = {
            model_remains: [
                { model_name: 'video', current_interval_remaining_percent: 10 },
                { model_name: 'general', current_interval_remaining_percent: 20 }
            ]
        }
        const windows = parseMinimaxQuotaResponse(payload, NOW_SEC)
        expect(windows?.find((w) => w.source === MINIMAX_5H_SOURCE)?.usedPercent).toBe(80)
        expect(windows?.find((w) => w.source === MINIMAX_VIDEO_SOURCE)?.usedPercent).toBe(90)
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
