import { useMemo, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { MACHINE_CAPABILITIES } from '@hapi/protocol/runnerCapabilities'
import type { MachineQuotaSnapshot, QuotaUnavailable, QuotaWindow } from '@hapi/protocol/quotas'
import type { ApiClient } from '@/api/client'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useMachines } from '@/hooks/queries/useMachines'
import { useQuotas } from '@/hooks/queries/useQuotas'
import { useTranslation } from '@/lib/use-translation'

const STALE_AFTER_MS = 15 * 60_000

type QuotaSourceParts = { provider: string; account: string | null; window: string }

/** Wire source IDs parse as `<provider>[:<account>]:<window>`. */
export function quotaSourceParts(source: string): QuotaSourceParts {
    const parts = source.split(':')
    if (parts.length >= 3) return { provider: parts[0], account: parts[1], window: parts[2] }
    if (parts.length === 2) return { provider: parts[0], account: null, window: parts[1] }
    return { provider: source, account: null, window: '' }
}

export function quotaLight(usedPercent: number): 'green' | 'yellow' | 'red' {
    return usedPercent < 50 ? 'green' : usedPercent < 85 ? 'yellow' : 'red'
}

/** Display order across providers: codex → GLM (z.ai) → Antigravity → OpenCode → Cursor → MiniMax. */
const PROVIDER_ORDER: Record<string, number> = { codex: 0, zai: 1, agy: 2, opencode: 3, cursor: 4, minimax: 100 }

export function sortQuotaWindows<T extends { source: string }>(windows: T[]): T[] {
    return [...windows].sort((a, b) => {
        const providerA = PROVIDER_ORDER[quotaSourceParts(a.source).provider] ?? 90
        const providerB = PROVIDER_ORDER[quotaSourceParts(b.source).provider] ?? 90
        return providerA !== providerB ? providerA - providerB : a.source.localeCompare(b.source)
    })
}

const LIGHT_BAR = { green: 'bg-green-500', yellow: 'bg-amber-500', red: 'bg-red-500' } as const

const PROVIDER_LABEL_KEYS: Record<string, string> = {
    zai: 'settings.limits.source.zai',
    codex: 'settings.limits.source.codex',
    claude: 'settings.limits.source.claude',
    cursor: 'settings.limits.source.cursor',
    agy: 'settings.limits.source.agy',
    minimax: 'settings.limits.source.minimax',
    opencode: 'settings.limits.source.opencode',
}

const WINDOW_LABEL_KEYS: Record<string, string> = {
    '5h': 'settings.limits.window.5h',
    weekly: 'settings.limits.window.weekly',
    monthly: 'settings.limits.window.monthly',
}

// Account segments stay out of the label: they are noisy on narrow screens
// and truncate the window part, which is the information that matters.
function sourceLabel(source: string, t: (key: string) => string): string {
    const { provider, window } = quotaSourceParts(source)
    const providerLabel = provider in PROVIDER_LABEL_KEYS ? t(PROVIDER_LABEL_KEYS[provider]!) : provider
    const windowLabel = window in WINDOW_LABEL_KEYS ? t(WINDOW_LABEL_KEYS[window]!) : window
    return [providerLabel, windowLabel].filter(Boolean).join(' · ')
}

export function formatReset(resetsAt: number | null, t: (key: string, params?: Record<string, string | number>) => string, alwaysShowDate = false): string {
    if (!resetsAt) return t('settings.limits.resetsUnknown')
    const target = new Date(resetsAt * 1000)
    const diffMs = target.getTime() - Date.now()
    if (diffMs <= 0) return t('settings.limits.resetsSoon')
    // Inside a 5-hour window the countdown already pins the wall-clock time
    // closely enough, and the date is usually "today" anyway — drop the date
    // from the absolute parenthetical even when the reset lands on tomorrow,
    // leaving just the 24-hour clock so the user can plan against it.
    const showAbsolute = alwaysShowDate || diffMs >= 5 * 3_600_000
    // Beyond a day out the weekday matters more than the countdown, so the
    // absolute gains a full English weekday ("Sunday, Oct 4, 21:16"). Pinned to
    // en-US with a 24-hour clock so the label reads consistently regardless of
    // locale and stays comparable to other relative times.
    const absolute = target.toLocaleString('en-US', {
        weekday: diffMs > 24 * 3_600_000 ? 'long' : undefined,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
    const timeOnly = target.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    // Precision tiers shrink as the horizon grows: <1min → under a minute,
    // <1h → minutes, <12h → h m, <24h → hours, <48h → d h, else whole days
    // (≥2 there, so the plural key is safe). Zero tails collapse ("5h" not "5h 0m").
    const minutes = Math.floor(diffMs / 60_000)
    const buildResets = (relative: string) => showAbsolute
        ? t('settings.limits.resets', { relative, absolute })
        : t('settings.limits.resetsTime', { relative, time: timeOnly })
    if (minutes < 1) return buildResets(t('settings.limits.inUnderMinute'))
    if (minutes < 60) return buildResets(t('settings.limits.inMinutes', { minutes }))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        const mins = minutes % 60
        const relative = hours < 12 && mins !== 0
            ? t('settings.limits.inHoursMinutes', { hours, minutes: mins })
            : t('settings.limits.inHours', { hours })
        return buildResets(relative)
    }
    if (hours < 48) {
        const hrs = hours % 24
        if (hrs === 0) return buildResets(t('settings.limits.inDay'))
        return buildResets(t('settings.limits.inDaysHours', { days: 1, hours: hrs }))
    }
    return buildResets(t('settings.limits.inDays', { days: Math.floor(hours / 24) }))
}

function formatAge(ageMs: number, t: (key: string, params?: Record<string, string | number>) => string): string {
    const minutes = Math.floor(ageMs / 60_000)
    if (minutes < 60) return t('settings.limits.ageMinutes', { minutes })
    return t('settings.limits.ageHours', { hours: Math.floor(minutes / 60) })
}

export function QuotaRow(props: { quotaWindow: QuotaWindow }) {
    const { t } = useTranslation()
    const light = quotaLight(props.quotaWindow.usedPercent)
    const staleForMs = Date.now() - props.quotaWindow.measuredAt * 1000
    const weightedPercent = props.quotaWindow.weightedPercent
    let usedLabel = t('settings.limits.used', { percent: Math.round(props.quotaWindow.usedPercent * 10) / 10 })
    if (weightedPercent !== undefined) {
        const approx = Math.round(weightedPercent * 10) / 10
        const integer = Math.round(weightedPercent)
        usedLabel = approx !== integer
            ? t('settings.limits.usedApprox', { percent: integer, approx })
            : t('settings.limits.used', { percent: integer })
    }
    return (
        <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-[var(--app-fg)]">
                    {sourceLabel(props.quotaWindow.source, t)}
                </span>
                <span className="shrink-0 text-[var(--app-hint)]">{usedLabel}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                <div className={`h-full rounded-full ${LIGHT_BAR[light]}`} style={{ width: `${Math.max(2, props.quotaWindow.usedPercent)}%` }} />
            </div>
            <div className="mt-1 text-xs text-[var(--app-hint)]">
                {formatReset(props.quotaWindow.resetsAt, t, quotaSourceParts(props.quotaWindow.source).window === 'monthly')}
                {quotaSourceParts(props.quotaWindow.source).window === '5h' && staleForMs > STALE_AFTER_MS
                    ? ` · ${t('settings.limits.stale', { ago: formatAge(staleForMs, t) })}`
                    : ''}
            </div>
        </div>
    )
}

export function UnavailableRow(props: { unavailable: QuotaUnavailable }) {
    const { t } = useTranslation()
    const isOpencode = quotaSourceParts(props.unavailable.source).provider === 'opencode'
    const goKeyExpired = isOpencode && props.unavailable.reason === 'auth_expired'
    const goConsoleSignIn = isOpencode && props.unavailable.detail === 'Console sign-in required'
    const reasonKey = `settings.limits.unavailable.${props.unavailable.reason}`
    let reason = props.unavailable.reason === 'auth_expired' || props.unavailable.reason === 'unavailable'
        ? t(reasonKey)
        : props.unavailable.reason
    if (goKeyExpired) reason = t('settings.limits.opencode.keyExpired')
    if (goConsoleSignIn) reason = t('settings.limits.opencode.reconnectConsole')
    return (
        <div className="px-3 py-3 text-sm">
            <div className={`flex items-center justify-between gap-3 ${goKeyExpired || goConsoleSignIn ? 'flex-wrap' : ''}`}>
                <span className="min-w-0 truncate text-[var(--app-fg)]">⚠️ {sourceLabel(props.unavailable.source, t)}</span>
                <span className="shrink-0 text-xs text-[var(--app-hint)]">{reason}</span>
            </div>
            {goKeyExpired ? (
                <div className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--app-hint)]">
                    <a href="https://opencode.ai/console" target="_blank" rel="noopener noreferrer" className="text-[var(--app-link)] underline underline-offset-2">
                        {t('settings.limits.opencode.createKey')}
                    </a>
                    <p>{t('settings.limits.opencode.replaceKey')}</p>
                </div>
            ) : null}
            {goConsoleSignIn ? (
                <p className="mt-2 text-xs leading-relaxed text-[var(--app-hint)]">{t('settings.limits.opencode.consoleSignIn')}</p>
            ) : null}
        </div>
    )
}

function MachineQuotaSection(props: { label: string; snapshot?: MachineQuotaSnapshot; children?: ReactNode }) {
    const { t } = useTranslation()
    const { snapshot } = props
    const statusParts: string[] = []
    if (snapshot) {
        const staleForMs = Date.now() - snapshot.receivedAt
        if (!snapshot.online) statusParts.push(t('settings.limits.offline'))
        if (staleForMs > STALE_AFTER_MS) statusParts.push(t('settings.limits.stale', { ago: formatAge(staleForMs, t) }))
    }

    const windows = useMemo(
        () => snapshot ? sortQuotaWindows(snapshot.quotas) : [],
        [snapshot]
    )
    return (
        <SettingsSection
            title={props.label}
            description={statusParts.length > 0 ? statusParts.join(' · ') : undefined}
        >
            {windows.map((quotaWindow) => (
                <QuotaRow key={quotaWindow.source} quotaWindow={quotaWindow} />
            ))}
            {snapshot?.unavailable.map((unavailable) => (
                <UnavailableRow key={unavailable.source} unavailable={unavailable} />
            ))}
            {props.children}
        </SettingsSection>
    )
}

export default function SettingsLimitsPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const query = useQuotas({ api })
    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const candidates = machines.filter(machine =>
        machine.active && machine.metadata?.capabilities?.includes(MACHINE_CAPABILITIES.AgentQuotas)
            && machine.metadata.capabilities.includes(MACHINE_CAPABILITIES.AgentAvailability)
    )
    const availability = useQueries({ queries: api ? candidates.map(({ id }) => ({
        queryKey: queryKeys.machineAgentAvailability(id),
        queryFn: () => api.getMachineAgentAvailability(id),
        staleTime: 30_000,
        retry: false,
    })) : [] })
    const claudeMachines = new Set(candidates.filter((_, index) =>
        availability[index]?.isSuccess && availability[index].data.agents.some(agent => agent.agent === 'claude' && agent.available)
    ).map(machine => machine.id))

    const snapshots = new Map(query.snapshots.map(snapshot => [snapshot.machineId, snapshot]))
    const machineNames = new Map(machines.map(({ id, metadata }) => [id, metadata?.displayName ?? metadata?.host]))
    const sections = [...new Set([...snapshots.keys(), ...claudeMachines])].map(id => ({
        id,
        label: snapshots.get(id)?.displayName ?? machineNames.get(id) ?? id,
        snapshot: snapshots.get(id),
    })).sort((a, b) => a.label.localeCompare(b.label))
    const isLoading = query.isLoading || (sections.length === 0 && (machinesLoading || availability.some(result => result.isPending)))

    return (
        <SettingsPageContent description={t('settings.limits.description')}>
            {isLoading ? <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.loading')}</div></SettingsSection> : null}
            {query.error ? <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.error')}</div></SettingsSection> : null}
            {sections.map(({ id, label, snapshot }) => (
                <MachineQuotaSection key={id} label={label} snapshot={snapshot}>
                    {api && claudeMachines.has(id) ? <ClaudeQuotaRows api={api} machineId={id} /> : null}
                </MachineQuotaSection>
            ))}
            {!isLoading && !query.error && sections.length === 0 ? (
                <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.empty')}</div></SettingsSection>
            ) : null}
        </SettingsPageContent>
    )
}

function ClaudeQuotaRows(props: { api: ApiClient; machineId: string }) {
    const { t } = useTranslation()
    const query = useQuery({
        queryKey: queryKeys.machineAgentQuotas(props.machineId),
        queryFn: () => props.api.getMachineAgentQuotas(props.machineId, true),
        enabled: false,
        retry: false,
    })
    const account = query.data?.accounts.find(entry => entry.agent === 'claude')
    const statusText = query.isError || account?.status === 'error' || account?.status === 'unavailable' ? t('settings.usage.quotas.status.error')
        : account?.status === 'unauthenticated' ? t('settings.usage.quotas.status.unauthenticated')
        : account?.status === 'custom_provider' ? t('settings.usage.quotas.status.custom_provider')
        : undefined
    return (
        <>
            <SettingsRow
                label={t('settings.limits.source.claude')}
                description={statusText}
                trailing={
                    <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
                        className="rounded-md border border-[var(--app-border)] px-2 py-1 text-sm disabled:opacity-50">
                        {t(query.isFetching ? 'settings.usage.quotas.refreshing' : 'settings.usage.quotas.refresh')}
                    </button>
                }
            />
            {account?.buckets.map(bucket => (
                <QuotaRow key={bucket.id} quotaWindow={{
                    source: `claude:${bucket.window ?? bucket.id}`,
                    usedPercent: bucket.usedPercent,
                    measuredAt: account.updatedAt / 1000,
                    resetsAt: bucket.resetsAt == null ? null : bucket.resetsAt / 1000,
                }} />
            ))}
        </>
    )
}
