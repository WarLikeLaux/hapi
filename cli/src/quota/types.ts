import type { QuotaUnavailableReason, QuotaWindow } from '@hapi/protocol/quotas'

/**
 * One collector cycle outcome. Sources without local credentials return
 * `skipped` (omitted from the report entirely); configured-but-failed sources
 * return `unavailable` so the web UI can show the reason.
 */
export type CollectorResult =
    | { kind: 'ok'; windows: QuotaWindow[] }
    | { kind: 'skipped' }
    | { kind: 'unavailable'; source: string; reason: QuotaUnavailableReason; detail?: string }

export function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.min(100, Math.max(0, value))
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}
