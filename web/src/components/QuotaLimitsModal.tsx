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
                </div>
            </DialogContent>
        </Dialog>
    )
}
