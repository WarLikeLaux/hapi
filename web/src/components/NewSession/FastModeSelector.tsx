import { useTranslation } from '@/lib/use-translation'
import type { NewSessionServiceTier } from './types'
import { CODEX_SPEED_LABELS } from '@/components/AssistantChat/codexFastMode'
import { ChoiceLabel } from './ChoiceLabel'

export type { NewSessionServiceTier }

export function FastModeSelector(props: {
    options: readonly NewSessionServiceTier[]
    value: NewSessionServiceTier
    isDisabled: boolean
    onChange: (value: NewSessionServiceTier) => void
}) {
    const { t } = useTranslation()

    if (props.options.length === 0) {
        return null
    }

    return (
        <section className="flex min-w-0 items-center gap-2 p-2 sm:gap-3 sm:p-3 lg:border-l lg:border-[var(--app-divider)]" role="group" aria-label={t('newSession.speed')}>
            <ChoiceLabel kind="speed" />
            <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:gap-3">
                {props.options.map((value) => (
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
                        {t(CODEX_SPEED_LABELS[value])}
                    </button>
                ))}
            </div>
        </section>
    )
}
