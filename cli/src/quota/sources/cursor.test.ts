import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { collectCursorQuota, parseCursorMonthlyUsage, cursorAuthPaths, CURSOR_MONTHLY_SOURCE } from './cursor'

const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    return { ...actual, homedir: () => state.home || actual.homedir() }
})

const NOW_SEC = 1_700_000_000
const CYCLE_END_MS = 1_700_200_000_000

describe('cursorAuthPaths', () => {
    it('uses the platform config location', () => {
        // The switch reads the live platform, so only the current branch is asserted.
        const expected = process.platform === 'darwin'
            ? join('/h', '.cursor', 'auth.json')
            : process.platform === 'win32'
                ? join('/h', 'AppData', 'Roaming', 'Cursor', 'auth.json')
                : join('/h', '.config', 'cursor', 'auth.json')
        expect(cursorAuthPaths({}, '/h')).toEqual([expected])
    })
})

describe('parseCursorMonthlyUsage', () => {
    it('sends the raw percent from cents math', () => {
        expect(parseCursorMonthlyUsage({
            billingCycleEnd: String(CYCLE_END_MS),
            planUsage: { limit: 2000, remaining: 500 }
        }, NOW_SEC)).toEqual({
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: 75,
            usedCents: 1500,
            limitCents: 2000,
            resetsAt: CYCLE_END_MS / 1000,
            measuredAt: NOW_SEC
        })
    })

    it('calculates used cents from totalSpend when remaining is absent', () => {
        expect(parseCursorMonthlyUsage({
            billingCycleEnd: String(CYCLE_END_MS),
            planUsage: { limit: 2000, totalSpend: 323 }
        }, NOW_SEC)).toEqual({
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: 16.15,
            usedCents: 323,
            limitCents: 2000,
            resetsAt: CYCLE_END_MS / 1000,
            measuredAt: NOW_SEC
        })
    })

    it('matches user response with autoPercentUsed pool percentage', () => {
        expect(parseCursorMonthlyUsage({
            billingCycleEnd: '1792523976000',
            planUsage: {
                totalSpend: 323,
                includedSpend: 323,
                remaining: 1677,
                limit: 2000,
                autoPercentUsed: 0.7177777777777777,
                totalPercentUsed: 0.6835978835978836
            }
        }, NOW_SEC)).toEqual({
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: 0.72,
            weightedPercent: 0.72,
            usedCents: 323,
            limitCents: 2000,
            resetsAt: 1792523976,
            measuredAt: NOW_SEC
        })
    })

    it('omits cents fields in the percent fallback', () => {
        const quotaWindow = parseCursorMonthlyUsage({ billingCycleEnd: '0', planUsage: { autoPercentUsed: 30 } }, NOW_SEC)
        expect(quotaWindow).toEqual({ source: CURSOR_MONTHLY_SOURCE, usedPercent: 30, weightedPercent: 30, resetsAt: null, measuredAt: NOW_SEC })
        expect(quotaWindow?.usedCents).toBeUndefined()
        expect(quotaWindow?.limitCents).toBeUndefined()
    })

    it('treats the unlimited sentinel as unusable cents data', () => {
        const quotaWindow = parseCursorMonthlyUsage({ planUsage: { limit: 2147483647, remaining: 1, autoPercentUsed: 10 } }, NOW_SEC)
        expect(quotaWindow?.usedPercent).toBe(10)
    })

    it('returns null on malformed payloads', () => {
        expect(parseCursorMonthlyUsage(null, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({}, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({ planUsage: {} }, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({ planUsage: { totalPercentUsed: 150 } }, NOW_SEC)).toBeNull()
    })
})

describe('collectCursorQuota', () => {
    it('follows CLI removal and return without deleting saved credentials or inventing quota', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-cursor-quota-'))
        state.home = directory
        const env = { PATH: directory, APPDATA: directory }
        const executable = join(directory, process.platform === 'win32' ? 'agent.EXE' : 'agent')
        const authPath = cursorAuthPaths(env)[0]!
        const auth = JSON.stringify({ accessToken: 'test-cursor-token' })
        mkdirSync(dirname(authPath), { recursive: true })
        writeFileSync(authPath, auth)
        const install = () => {
            writeFileSync(executable, '#!/bin/sh\nexit 0\n')
            chmodSync(executable, 0o755)
        }
        const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
            billingCycleEnd: String(CYCLE_END_MS), planUsage: { autoPercentUsed: 0 }
        })))
        vi.stubGlobal('fetch', fetchMock)
        try {
            install()
            expect(await collectCursorQuota(NOW_SEC, env)).toEqual({
                kind: 'ok', windows: [{ source: CURSOR_MONTHLY_SOURCE, usedPercent: 0,
                    weightedPercent: 0, resetsAt: CYCLE_END_MS / 1000, measuredAt: NOW_SEC }]
            })
            rmSync(executable)
            fetchMock.mockClear()
            expect(await collectCursorQuota(NOW_SEC + 300, env)).toEqual({ kind: 'skipped' })
            expect(fetchMock).not.toHaveBeenCalled()
            expect(readFileSync(authPath, 'utf8')).toBe(auth)

            install()
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ planUsage: { autoPercentUsed: 27 } })))
            expect(await collectCursorQuota(NOW_SEC + 600, env)).toEqual({
                kind: 'ok', windows: [{ source: CURSOR_MONTHLY_SOURCE, usedPercent: 27,
                    weightedPercent: 27, resetsAt: null, measuredAt: NOW_SEC + 600 }]
            })

            fetchMock.mockImplementationOnce(async () => {
                rmSync(executable)
                return new Response(JSON.stringify({ planUsage: { autoPercentUsed: 0 } }))
            })
            expect(await collectCursorQuota(NOW_SEC + 900, env)).toEqual({ kind: 'skipped' })
        } finally {
            vi.unstubAllGlobals()
            state.home = ''
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
