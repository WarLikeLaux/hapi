import { useState } from 'react'
import { usePwaUpdateContext } from '@/lib/pwa-update-context'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { resetAppCaches } from '@/lib/appCacheReset'

export function PwaUpdateBanner({ topClassName }: { topClassName?: string } = {}) {
    const { t } = useTranslation()
    const { updating, updateFailed } = usePwaUpdateContext()
    const [resetting, setResetting] = useState(false)

    if (!updating && !updateFailed) {
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
                {t(updateFailed ? 'pwa.updateFailed.title' : 'pwa.updating.title')}
            </p>
            <p className="text-xs text-[var(--app-hint)] mt-0.5">
                {t(updateFailed ? 'pwa.updateFailed.body' : 'pwa.updating.body')}
            </p>
            {updateFailed ? (
                <button
                    type="button"
                    disabled={resetting}
                    onClick={() => {
                        setResetting(true)
                        void resetAppCaches()
                            .catch((error) => console.error('App cache reset failed:', error))
                            .finally(() => window.location.reload())
                    }}
                    className="mt-3 min-h-11 rounded-lg bg-[var(--app-fg)] px-3 py-2 text-sm font-medium text-[var(--app-bg)] disabled:opacity-50"
                >
                    {t(resetting ? 'settings.about.resetCache.busy' : 'pwa.updateFailed.reload')}
                </button>
            ) : null}
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
