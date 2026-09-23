import { z } from 'zod'

/**
 * Normalized subscription-quota window for one provider account.
 *
 * `source` is a stable string ID parsed by clients as
 * `<provider>[:<account>]:<window>`:
 *
 *   - `zai:5h`              — Z.AI Coding Plan 5-hour token window (GLM)
 *   - `codex:5h`            — Codex 5-hour window (same snapshot as weekly)
 *   - `codex:weekly`        — Codex weekly window
 *   - `cursor:monthly`      — Cursor monthly billing-cycle window
 *   - `agy:<email>:5h`      — Antigravity account 5-hour Gemini window
 *   - `agy:<email>:weekly`  — Antigravity account weekly Gemini window
 *
 * `usedPercent` is how much is SPENT (0..100), matching every provider's own
 * reporting; remaining is `100 - usedPercent`.
 */
export const QuotaWindowSchema = z.object({
    source: z.string().min(1),
    usedPercent: z.number().min(0).max(100),
    /** Unix seconds; null when the provider did not report a reset time. */
    resetsAt: z.number().nullable(),
    /** Unix seconds of the runner's measurement — the base for staleness display. */
    measuredAt: z.number()
})

export type QuotaWindow = z.infer<typeof QuotaWindowSchema>

/**
 * A source the runner tracks but could not measure this cycle. Sources without
 * local credentials are omitted entirely, so an entry here means "configured
 * but failed".
 */
export const QuotaUnavailableSchema = z.object({
    source: z.string().min(1),
    reason: z.enum(['auth_expired', 'unavailable']),
    detail: z.string().max(200).optional()
})

export type QuotaUnavailable = z.infer<typeof QuotaUnavailableSchema>
export type QuotaUnavailableReason = QuotaUnavailable['reason']

/** Runner → hub payload for the `machine-quota-update` socket event. */
export const MachineQuotaUpdateSchema = z.object({
    machineId: z.string().min(1),
    /** Unix seconds of the collection cycle that produced this report. */
    capturedAt: z.number(),
    quotas: z.array(QuotaWindowSchema),
    unavailable: z.array(QuotaUnavailableSchema)
})

export type MachineQuotaUpdate = z.infer<typeof MachineQuotaUpdateSchema>

/** Hub-side view served to web clients: the last report plus machine display info. */
export const MachineQuotaSnapshotSchema = z.object({
    machineId: z.string().min(1),
    displayName: z.string().nullable(),
    online: z.boolean(),
    capturedAt: z.number(),
    receivedAt: z.number(),
    quotas: z.array(QuotaWindowSchema),
    unavailable: z.array(QuotaUnavailableSchema)
})

export type MachineQuotaSnapshot = z.infer<typeof MachineQuotaSnapshotSchema>

export const QuotasResponseSchema = z.object({
    quotas: z.array(MachineQuotaSnapshotSchema)
})

export type QuotasResponse = z.infer<typeof QuotasResponseSchema>
