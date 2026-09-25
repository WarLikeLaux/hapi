import { useEffect } from 'react'
import type { MachineQuotaSnapshot } from '@hapi/protocol/quotas'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useQuotas } from '@/hooks/queries/useQuotas'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { QuotaRow, UnavailableRow, sortQuotaWindows } from '@/routes/settings/limits'

function snapshotLabel(snapshot: MachineQuotaSnapshot): string {
    return snapshot.displayName ?? snapshot.machineId.slice(0, 8)
}

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** Quick limits glance from the sidebar header gauge button. */
export function QuotaLimitsModal(props: { isOpen: boolean; onClose: () => void }) {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { snapshots, isLoading, error, refetch } = useQuotas({ api })

    useEffect(() => {
        if (props.isOpen) {
            refetch()
        }
    }, [props.isOpen, refetch])

    const showMachineLabels = snapshots.length > 1
    // The cheat sheet earns its place only when a weekday name is actually
    // visible in the rows above, i.e. some reset is more than a day away.
    const hasWeekdayResets = snapshots.some((snapshot) =>
        snapshot.quotas.some((quotaWindow) => (quotaWindow.resetsAt ?? 0) * 1000 - Date.now() > 24 * 3_600_000)
    )

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('settings.limits.title')}</DialogTitle>
                    <DialogDescription>{t('settings.limits.summary')}</DialogDescription>
                </DialogHeader>
                <div className="mt-2 max-h-[70vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="px-1 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.loading')}</div>
                    ) : error ? (
                        <div className="px-1 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.error')}</div>
                    ) : snapshots.every((snapshot) => snapshot.quotas.length === 0 && snapshot.unavailable.length === 0) ? (
                        <div className="px-1 py-4 text-sm text-[var(--app-hint)]">{t('settings.limits.empty')}</div>
                    ) : (
                        snapshots.map((snapshot) => (
                            <div key={snapshot.machineId} className="mb-2 last:mb-0">
                                {showMachineLabels ? (
                                    <div className="px-1 pb-1 pt-2 text-xs font-medium text-[var(--app-hint)] first:pt-0">
                                        {snapshotLabel(snapshot)}
                                        {!snapshot.online ? ` · ${t('settings.limits.offline')}` : ''}
                                    </div>
                                ) : null}
                                <div className="divide-y divide-[var(--app-divider)] overflow-hidden rounded-lg border border-[var(--app-border)]">
                                    {sortQuotaWindows(snapshot.quotas).map((quotaWindow) => (
                                        <QuotaRow key={quotaWindow.source} quotaWindow={quotaWindow} />
                                    ))}
                                    {snapshot.unavailable.map((unavailable) => (
                                        <UnavailableRow key={unavailable.source} unavailable={unavailable} />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                    {hasWeekdayResets ? (
                        <details className="group mt-2">
                            <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1 text-xs text-[var(--app-hint)] [&::-webkit-details-marker]:hidden">
                                {t('settings.limits.weekdays.title')}
                                <span className="ml-auto text-[10px] transition-transform group-open:rotate-180" aria-hidden="true">▼</span>
                            </summary>
                            <table className="mt-1 w-full pb-1 text-xs">
                                <tbody className="divide-y divide-[var(--app-divider)]">
                                    {WEEKDAY_KEYS.map((day) => (
                                        <tr key={day}>
                                            <td className="py-1 font-medium capitalize text-[var(--app-fg)]">{day}</td>
                                            <td className="py-1 text-right text-[var(--app-hint)]">{t(`settings.limits.weekdays.${day}`)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </details>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    )
}
