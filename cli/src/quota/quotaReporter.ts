import type { MachineQuotaUpdate, QuotaUnavailable, QuotaWindow } from '@hapi/protocol/quotas'
import { logger } from '@/ui/logger'
import { collectAgyQuotas } from './sources/agy'
import { collectCodexQuotas } from './sources/codex'
import { collectCursorQuota } from './sources/cursor'
import { collectZaiQuota } from './sources/zai'

const QUOTA_POLL_INTERVAL_MS = 5 * 60_000

type QuotaReport = Omit<MachineQuotaUpdate, 'machineId'>

/**
 * Periodically collects subscription-quota windows on the runner machine and
 * pushes the normalized snapshot to the hub. Sources without local
 * credentials are silently omitted; tokens never leave the machine.
 */
export class QuotaReporter {
    private timer: NodeJS.Timeout | null = null
    private inFlight = false
    private last: QuotaReport | null = null

    constructor(
        private readonly machineId: string,
        private readonly emit: (update: MachineQuotaUpdate) => void
    ) {}

    start(): void {
        this.stopTimer()
        // A hub restart loses its in-memory snapshots; replaying the cached
        // report on (re)connect repopulates it without waiting for a cycle.
        if (this.last) {
            this.emit({ ...this.last, machineId: this.machineId })
        }
        void this.collect()
        this.timer = setInterval(() => {
            void this.collect()
        }, QUOTA_POLL_INTERVAL_MS)
        this.timer.unref?.()
    }

    stop(): void {
        this.stopTimer()
    }

    async collect(): Promise<void> {
        if (this.inFlight) return
        this.inFlight = true
        try {
            const nowSec = Math.floor(Date.now() / 1000)
            const previousAgy = (this.last?.quotas ?? []).filter((quotaWindow) => quotaWindow.source.startsWith('agy:'))
            const [zai, codex, agy, cursor] = await Promise.all([
                collectZaiQuota(nowSec),
                collectCodexQuotas(nowSec),
                collectAgyQuotas(previousAgy, nowSec),
                collectCursorQuota(nowSec)
            ])

            const next: QuotaReport = {
                capturedAt: nowSec,
                quotas: [zai, codex, agy, cursor].flatMap((result) => (result.kind === 'ok' ? result.windows : [])),
                unavailable: [zai, codex, agy, cursor].flatMap((result) => (
                    result.kind === 'unavailable'
                        ? [{ source: result.source, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) }]
                        : []
                ))
            }
            const changed = !this.last || !sameReport(this.last, next)
            this.last = next
            if (changed) {
                this.emit({ ...next, machineId: this.machineId })
            }
        } catch (error) {
            logger.debug('[QUOTA] collection cycle failed', error instanceof Error ? error.message : String(error))
        } finally {
            this.inFlight = false
        }
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }
}

function sameReport(left: QuotaReport, right: QuotaReport): boolean {
    // capturedAt moves every cycle by design; only window content decides
    // whether clients need a new snapshot.
    return JSON.stringify(sortedWindows(left)) === JSON.stringify(sortedWindows(right))
}

function sortedWindows(report: QuotaReport): {
    quotas: QuotaWindow[]
    unavailable: QuotaUnavailable[]
} {
    return {
        quotas: [...report.quotas].sort((a, b) => a.source.localeCompare(b.source)),
        unavailable: [...report.unavailable].sort((a, b) => a.source.localeCompare(b.source))
    }
}
