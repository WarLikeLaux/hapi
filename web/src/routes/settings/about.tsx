import { PROTOCOL_VERSION } from '@hapi/protocol'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

export default function SettingsAboutPage() {
    const { t, locale } = useTranslation()
    const buildTime = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    }).format(new Date(__BUILD_TIME__))
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
        </SettingsPageContent>
    )
}
