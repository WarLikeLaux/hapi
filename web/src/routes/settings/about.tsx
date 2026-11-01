import { useEffect, useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { resetAppCaches } from '@/lib/appCacheReset'
import { SettingsPageContent } from '@/components/settings/SettingsPrimitives'
import gojoLaptop from '@/assets/illustrations/gojo-launch-laptop.webp'
import gojoUpToDate from '@/assets/illustrations/gojo-up-to-date.webp'
import gojoUpdateAvailable from '@/assets/illustrations/gojo-update-available.webp'

function UpdateIcon({ status }: { status: 'checking' | 'current' | 'available' | 'unavailable' | 'updating' }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            {status === 'current' ? <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.3 2.3 4.8-4.8" /></>
                : status === 'unavailable' ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></>
                    : <><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" /><path d="M6 21v-4h4M18 3v4h-4" /></>}
        </svg>
    )
}

export default function SettingsAboutPage() {
    const { t } = useTranslation()
    const [cacheResetting, setCacheResetting] = useState(false)
    const [updateStatus, setUpdateStatus] = useState<'checking' | 'current' | 'available' | 'unavailable' | 'updating'>('checking')

    const checkUpdate = async () => {
        setUpdateStatus('checking')
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}build-info.json`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
            if (!response.ok) throw new Error('Build information unavailable')
            const info: unknown = await response.json()
            if (!info || typeof info !== 'object' || !('buildId' in info) || typeof info.buildId !== 'string' || !info.buildId) throw new Error('Invalid build information')
            setUpdateStatus(info.buildId === __BUILD_ID__ ? 'current' : 'available')
        } catch {
            setUpdateStatus('unavailable')
        }
    }

    useEffect(() => { void checkUpdate() }, [])

    const handleUpdate = async () => {
        setUpdateStatus('updating')
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                const registration = await navigator.serviceWorker.getRegistration()
                if (!registration) throw new Error('Service worker unavailable')
                const previousController = navigator.serviceWorker.controller
                const onControllerChange = () => {
                    if (navigator.serviceWorker.controller && navigator.serviceWorker.controller !== previousController) {
                        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
                        window.location.reload()
                    }
                }
                navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
                window.setTimeout(() => {
                    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
                    setUpdateStatus(current => current === 'updating' ? 'unavailable' : current)
                }, 35_000)
                await registration.update()
                // The global handler observes new installations; also handle a
                // worker that was already waiting when the button was pressed.
                registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
            } else {
                window.location.reload()
            }
        } catch {
            setUpdateStatus('unavailable')
        }
    }

    const handleResetCache = () => {
        setCacheResetting(true)
        // Safety net: mobile WebViews can stall cache/SW promises even with
        // per-step timeouts. Never leave the button stuck on "Clearing…".
        const fallback = window.setTimeout(() => window.location.reload(), 15_000)
        void resetAppCaches()
            .catch((error) => {
                console.error('App cache reset failed:', error)
            })
            .finally(() => {
                // A reload is wanted even if the reset partially failed: the
                // navigation re-fetches the shell and re-registers a worker.
                window.clearTimeout(fallback)
                window.location.reload()
            })
    }

    return (
        <SettingsPageContent>
            <div className="relative isolate overflow-hidden rounded-xl bg-[#101820]">
                <img src={updateStatus === 'current' ? gojoUpToDate : updateStatus === 'available' || updateStatus === 'updating' ? gojoUpdateAvailable : gojoLaptop} alt="" aria-hidden="true" className="aspect-[16/9] w-full object-cover" />
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 px-5 pb-4 sm:px-6 sm:pb-5">
                    <span className="text-xl font-semibold tracking-tight text-white sm:text-2xl">HAPI</span>
                </div>
            </div>
            <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-4 px-4 py-5 sm:flex-nowrap sm:px-6 sm:py-6">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--app-bg)] text-[var(--app-link)]">
                        <UpdateIcon status={updateStatus} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold text-[var(--app-fg)]">{t('settings.about.update.title')}</h2>
                        <p role="status" className="mt-1 text-sm leading-relaxed text-[var(--app-hint)]">{t(`settings.about.update.${updateStatus}`)}</p>
                    </div>
                    {updateStatus === 'available' ? <button type="button" onClick={() => void handleUpdate()} className="min-h-11 w-full shrink-0 rounded-lg bg-[var(--app-button)] px-4 py-2 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] sm:ml-auto sm:w-auto">{t('settings.about.update.action')}</button> : null}
                    {updateStatus === 'current' || updateStatus === 'unavailable' ? <button type="button" onClick={() => void checkUpdate()} className="min-h-11 w-full shrink-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] sm:ml-auto sm:w-auto">{t('settings.about.update.check')}</button> : null}
                </div>
            </section>
            <section className="flex flex-wrap items-center gap-x-6 gap-y-3 px-1 pt-2 sm:flex-nowrap sm:px-2">
                <div className="min-w-0 flex-1 basis-52">
                    <h2 className="text-sm font-semibold text-[var(--app-fg)]">{t('settings.about.resetCache')}</h2>
                    <p className="mt-1 max-w-[55ch] text-sm leading-relaxed text-[var(--app-hint)]">{t('settings.about.resetCacheDescription')}</p>
                </div>
                <button
                    type="button"
                    onClick={handleResetCache}
                    disabled={cacheResetting}
                    className="min-h-11 w-full shrink-0 rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50 sm:ml-auto sm:w-auto"
                >
                    {cacheResetting ? t('settings.about.resetCache.busy') : t('settings.about.resetCache.action')}
                </button>
            </section>
        </SettingsPageContent>
    )
}
