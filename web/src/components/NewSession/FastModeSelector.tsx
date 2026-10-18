import { useTranslation } from '@/lib/use-translation'
import type { NewSessionServiceTier } from './types'

export type { NewSessionServiceTier }

export function FastModeSelector(props: {
    visible: boolean
    value: NewSessionServiceTier
    isDisabled: boolean
    onChange: (value: NewSessionServiceTier) => void
}) {
    const { t } = useTranslation()

    if (!props.visible) {
        return null
    }

    return (
        <section className="p-2 sm:p-3" role="group" aria-label={t('newSession.fastMode')}>
            <div className="flex flex-wrap gap-2 sm:gap-3">
                {(['standard', 'fast'] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={props.value === value}
                        disabled={props.isDisabled}
                        onClick={() => props.onChange(value)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50 ${
                            props.value === value
                                ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
                                : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                        }`}
                    >
                        {t(value === 'fast' ? 'misc.fastModeFast' : 'misc.fastModeStandard')}
                    </button>
                ))}
            </div>
        </section>
    )
}
