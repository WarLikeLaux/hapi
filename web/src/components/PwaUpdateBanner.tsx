import { usePwaUpdateContext } from '@/lib/pwa-update-context'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'

export function PwaUpdateBanner({ topClassName }: { topClassName?: string } = {}) {
    const { t } = useTranslation()
    const { updating } = usePwaUpdateContext()

    if (!updating) {
        return null
    }

    const topClass = topClassName ?? 'top-[calc(env(safe-area-inset-top)+0.5rem)]'

    return (
        <div
            data-testid="pwa-update-banner"
            role="status"
            aria-live="polite"
            className={`fixed left-4 right-4 bg-[var(--app-secondary-bg)] border border-[var(--app-border)] rounded-lg p-4 shadow-lg z-50 ${topClass}`}
        >
            <p className="text-sm font-medium text-[var(--app-fg)]">
                {t('pwa.updating.title')}
            </p>
            <p className="text-xs text-[var(--app-hint)] mt-0.5">
                {t('pwa.updating.body')}
            </p>
        </div>
    )
}

export function PwaUpdateBannerWithStatusOffset({
    isSyncing,
    isReconnecting,
}: {
    isSyncing: boolean
    isReconnecting: boolean
}) {
    const voice = useVoiceOptional()
    const hasTopStatusBanner =
        isSyncing ||
        isReconnecting ||
        Boolean(voice && voice.status === 'error' && voice.errorMessage)

    return (
        <PwaUpdateBanner
            topClassName={hasTopStatusBanner
                ? 'top-[calc(env(safe-area-inset-top)+3rem)]'
                : undefined}
        />
    )
}
