import { describe, expect, it, vi } from 'vitest'
import type { MachineQuotaUpdate } from '@hapi/protocol/quotas'
import type { CollectorResult } from './types'
import { QuotaReporter } from './quotaReporter'

const sources = vi.hoisted(() => ({ cursor: vi.fn(), codex: vi.fn() }))
vi.mock('./sources/cursor', () => ({ collectCursorQuota: sources.cursor }))
vi.mock('./sources/codex', () => ({ collectCodexQuotas: sources.codex }))
vi.mock('./sources/zai', () => ({ collectZaiQuota: async () => ({ kind: 'skipped' }) }))
vi.mock('./sources/agy', () => ({ collectAgyQuotas: async () => ({ kind: 'skipped' }) }))
vi.mock('./sources/minimax', () => ({ collectMinimaxQuotas: async () => ({ kind: 'skipped' }) }))
vi.mock('./sources/opencode', () => ({ collectOpencodeQuota: async () => ({ kind: 'skipped' }) }))

describe('QuotaReporter reconnect', () => {
    it('recollects before publishing so a removed agent is retired while other quotas remain', async () => {
        const codex = { source: 'codex:5h', usedPercent: 42, resetsAt: null, measuredAt: 1_700_000_000 }
        const cursor = { source: 'cursor:monthly', usedPercent: 0, resetsAt: 1_702_000_000, measuredAt: 1_700_000_000 }
        sources.codex.mockResolvedValue({ kind: 'ok', windows: [codex] })
        sources.cursor.mockResolvedValue({ kind: 'ok', windows: [cursor] })
        const reports: MachineQuotaUpdate[] = []
        const reporter = new QuotaReporter('machine', (report) => reports.push(report))
        try {
            await reporter.collect()
            expect(reports[0]?.quotas).toEqual([codex, cursor])
            reporter.stop()
            reports.length = 0
            let finish!: (result: CollectorResult) => void
            sources.cursor.mockImplementationOnce(() => new Promise<CollectorResult>((resolve) => { finish = resolve }))
            reporter.start()
            expect(reports).toEqual([])
            finish({ kind: 'skipped' })
            await vi.waitFor(() => expect(reports).toHaveLength(1))
            expect(reports[0]?.quotas).toEqual([codex])
            expect(reports[0]?.unavailable).toEqual([])
            // A restarted hub still needs a snapshot when nothing changed.
            reporter.stop()
            reports.length = 0
            sources.cursor.mockResolvedValue({ kind: 'skipped' })
            reporter.start()
            await vi.waitFor(() => expect(reports).toHaveLength(1))
            expect(reports[0]?.quotas).toEqual([codex])
        } finally {
            reporter.stop()
            vi.resetAllMocks()
        }
    })
})
