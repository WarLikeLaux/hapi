import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MachineQuotaSnapshot, QuotaUnavailable, QuotaWindow } from '@hapi/protocol/quotas'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
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

/** Display order across providers: codex → GLM (z.ai) → Antigravity → Cursor. */
const PROVIDER_ORDER: Record<string, number> = { codex: 0, zai: 1, agy: 2, cursor: 3 }

export function sortQuotaWindows<T extends { source: string }>(windows: T[]): T[] {
    return [...windows].sort((a, b) => {
        const providerA = PROVIDER_ORDER[quotaSourceParts(a.source).provider] ?? 90
        const providerB = PROVIDER_ORDER[quotaSourceParts(b.source).provider] ?? 90
        return providerA !== providerB ? providerA - providerB : a.source.localeCompare(b.source)
    })
}

const LIGHT_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴' } as const
const LIGHT_BAR = { green: 'bg-green-500', yellow: 'bg-amber-500', red: 'bg-red-500' } as const

const PROVIDER_LABEL_KEYS: Record<string, string> = {
    zai: 'settings.limits.source.zai',
    codex: 'settings.limits.source.codex',
    cursor: 'settings.limits.source.cursor',
    agy: 'settings.limits.source.agy',
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

function formatReset(resetsAt: number | null, t: (key: string, params?: Record<string, string | number>) => string): string {
    if (!resetsAt) return t('settings.limits.resetsUnknown')
    const target = new Date(resetsAt * 1000)
    const absolute = target.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const diffMs = target.getTime() - Date.now()
    if (diffMs <= 0) return t('settings.limits.resetsSoon')
    const hours = Math.floor(diffMs / 3_600_000)
    const relative = hours >= 24
        ? t('settings.limits.inDays', { days: Math.floor(hours / 24) })
        : t('settings.limits.inHours', { hours })
    return t('settings.limits.resets', { relative, absolute })
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
    return (
        <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-[var(--app-fg)]">
                    {LIGHT_EMOJI[light]} {sourceLabel(props.quotaWindow.source, t)}
                </span>
                <span className="shrink-0 text-[var(--app-hint)]">{t('settings.limits.used', { percent: Math.round(props.quotaWindow.usedPercent * 10) / 10 })}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                <div className={`h-full rounded-full ${LIGHT_BAR[light]}`} style={{ width: `${Math.max(2, props.quotaWindow.usedPercent)}%` }} />
            </div>
            <div className="mt-1 text-xs text-[var(--app-hint)]">
                {formatReset(props.quotaWindow.resetsAt, t)}
                {staleForMs > STALE_AFTER_MS ? ` · ${t('settings.limits.stale', { ago: formatAge(staleForMs, t) })}` : ''}
            </div>
        </div>
    )
}

export function UnavailableRow(props: { unavailable: QuotaUnavailable }) {
    const { t } = useTranslation()
    const reasonKey = `settings.limits.unavailable.${props.unavailable.reason}`
    const reason = props.unavailable.reason === 'auth_expired' || props.unavailable.reason === 'unavailable'
        ? t(reasonKey)
        : props.unavailable.reason
    return (
        <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
            <span className="min-w-0 truncate text-[var(--app-fg)]">⚠️ {sourceLabel(props.unavailable.source, t)}</span>
            <span className="shrink-0 text-xs text-[var(--app-hint)]">{reason}</span>
        </div>
    )
}

function MachineQuotaSection(props: { snapshot: MachineQuotaSnapshot }) {
    const { t } = useTranslation()
    const label = props.snapshot.displayName ?? props.snapshot.machineId
    const staleForMs = Date.now() - props.snapshot.receivedAt
    const statusParts: string[] = []
    if (!props.snapshot.online) statusParts.push(t('settings.limits.offline'))
    if (staleForMs > STALE_AFTER_MS) statusParts.push(t('settings.limits.stale', { ago: formatAge(staleForMs, t) }))

    const windows = useMemo(
        () => sortQuotaWindows(props.snapshot.quotas),
        [props.snapshot.quotas]
    )
    return (
        <SettingsSection
            title={label}
            description={statusParts.length > 0 ? statusParts.join(' · ') : undefined}
        >
            <div className="divide-y divide-[var(--app-divider)]">
                {windows.map((quotaWindow) => (
                    <QuotaRow key={quotaWindow.source} quotaWindow={quotaWindow} />
                ))}
                {props.snapshot.unavailable.map((unavailable) => (
                    <UnavailableRow key={unavailable.source} unavailable={unavailable} />
                ))}
            </div>
        </SettingsSection>
    )
}

export default function SettingsLimitsPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const query = useQuery({
        queryKey: queryKeys.quotas,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getQuotas()
        },
        enabled: Boolean(api),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false
    })

    const snapshots = useMemo(
        () => [...(query.data?.quotas ?? [])].sort((a, b) => (a.displayName ?? a.machineId).localeCompare(b.displayName ?? b.machineId)),
        [query.data?.quotas]
    )
    const hasContent = snapshots.some((snapshot) => snapshot.quotas.length > 0 || snapshot.unavailable.length > 0)

    return (
        <SettingsPageContent description={t('settings.limits.description')}>
            {query.isLoading ? <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.loading')}</div></SettingsSection> : null}
            {query.error ? <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.error')}</div></SettingsSection> : null}
            {!query.isLoading && !query.error && snapshots.map((snapshot) => (
                <MachineQuotaSection key={snapshot.machineId} snapshot={snapshot} />
            ))}
            {!query.isLoading && !query.error && !hasContent ? (
                <SettingsSection><div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.empty')}</div></SettingsSection>
            ) : null}
        </SettingsPageContent>
    )
}
