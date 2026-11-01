import { useEffect, useState } from 'react'
import { useAppearance } from '@/hooks/useTheme'
import { useColorTheme } from '@/hooks/useColorTheme'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

function measureWindow() {
    return {
        layout: `${window.innerWidth} × ${window.innerHeight}`,
        visual: window.visualViewport
            ? `${Math.round(window.visualViewport.width)} × ${Math.round(window.visualViewport.height)}`
            : '—',
        pixelRatio: String(window.devicePixelRatio),
        displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
        systemScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        appliedAppearance: document.documentElement.dataset.theme ?? '—',
    }
}

export default function SettingsDebugPage() {
    const { t } = useTranslation()
    const { appearance } = useAppearance()
    const { colorTheme } = useColorTheme()
    const [measurement, setMeasurement] = useState(measureWindow)

    useEffect(() => {
        const update = () => setMeasurement(measureWindow())
        const scheme = window.matchMedia('(prefers-color-scheme: dark)')
        const observer = new MutationObserver(update)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
        window.addEventListener('resize', update)
        window.visualViewport?.addEventListener('resize', update)
        scheme.addEventListener('change', update)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', update)
            window.visualViewport?.removeEventListener('resize', update)
            scheme.removeEventListener('change', update)
        }
    }, [])

    const value = (text: string) => <span className="font-mono text-sm text-[var(--app-hint)]">{text}</span>
    return (
        <SettingsPageContent description={t('settings.debug.description')}>
            <SettingsSection title={t('settings.debug.window')}>
                <SettingsRow label={t('settings.debug.layoutViewport')} trailing={value(measurement.layout)} />
                <SettingsRow label={t('settings.debug.visualViewport')} trailing={value(measurement.visual)} />
                <SettingsRow label={t('settings.debug.pixelRatio')} trailing={value(measurement.pixelRatio)} />
                <SettingsRow label={t('settings.debug.displayMode')} trailing={value(measurement.displayMode)} />
            </SettingsSection>
            <SettingsSection title={t('settings.debug.appearance')}>
                <SettingsRow label={t('settings.debug.colorTheme')} trailing={value(colorTheme)} />
                <SettingsRow label={t('settings.display.appearanceMode')} trailing={value(appearance)} />
                <SettingsRow label={t('settings.debug.appliedAppearance')} trailing={value(measurement.appliedAppearance)} />
                <SettingsRow label={t('settings.debug.systemScheme')} trailing={value(measurement.systemScheme)} />
            </SettingsSection>
        </SettingsPageContent>
    )
}
