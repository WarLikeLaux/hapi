import { useState } from 'react'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import { useTranslation } from '@/lib/use-translation'
import { resetAppCaches } from '@/lib/appCacheReset'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

export default function SettingsAboutPage() {
    const { t, locale } = useTranslation()
    const [cacheResetting, setCacheResetting] = useState(false)
    const buildTime = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    }).format(new Date(__BUILD_TIME__))

    const handleResetCache = () => {
        setCacheResetting(true)
        void resetAppCaches()
            .catch((error) => {
                console.error('App cache reset failed:', error)
            })
            .finally(() => {
                // A reload is wanted even if the reset partially failed: the
                // navigation re-fetches the shell and re-registers a worker.
                window.location.reload()
            })
    }

    return (
        <SettingsPageContent description={t('settings.about.description')}>
            <SettingsSection>
                <SettingsRow label={t('settings.about.website')} trailing={
                    <a href="https://hapi.run" target="_blank" rel="noopener noreferrer" className="text-[var(--app-link)] hover:underline">hapi.run</a>
                } />
                <SettingsRow label={t('settings.about.appVersion')} trailing={<span className="text-[var(--app-hint)]">{__APP_VERSION__}</span>} />
                <SettingsRow label={t('settings.about.buildId')} trailing={<span className="font-mono text-xs text-[var(--app-hint)]">{__BUILD_ID__}</span>} />
                <SettingsRow label={t('settings.about.buildTime')} trailing={<span className="text-[var(--app-hint)]" title={__BUILD_TIME__}>{buildTime}</span>} />
                <SettingsRow label={t('settings.about.protocolVersion')} trailing={<span className="text-[var(--app-hint)]">{PROTOCOL_VERSION}</span>} />
            </SettingsSection>
            <SettingsSection>
                <SettingsRow
                    label={t('settings.about.resetCache')}
                    description={t('settings.about.resetCacheDescription')}
                >
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={handleResetCache}
                            disabled={cacheResetting}
                            className="rounded-lg bg-[var(--app-button)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50"
                        >
                            {cacheResetting ? t('settings.about.resetCache.busy') : t('settings.about.resetCache.action')}
                        </button>
                    </div>
                </SettingsRow>
            </SettingsSection>
        </SettingsPageContent>
    )
}
