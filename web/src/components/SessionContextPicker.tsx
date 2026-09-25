import { useTranslation } from '@/lib/use-translation'
import type { SessionContextId } from '@/lib/sessionContexts'
import { cn } from '@/lib/utils'

export const SESSION_CONTEXT_TAG_IDS = ['work', 'lab', 'chill'] as const
export type SessionContextTagId = (typeof SESSION_CONTEXT_TAG_IDS)[number]

const CONTEXT_EMOJI: Record<SessionContextTagId, string> = {
    work: '💼',
    lab: '🧪',
    chill: '💬',
}

const chipBaseClass =
    'inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

const chipSelectedClass =
    'border-[var(--app-link)] bg-[var(--app-link)]/10 text-[var(--app-link)] font-semibold shadow-sm'

const chipIdleClass =
    'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'

type SessionContextPickerProps = {
    currentContext?: SessionContextId
    onSelect: (context: SessionContextTagId | null) => void
    onClose?: () => void
    className?: string
}

export function SessionContextPicker(props: SessionContextPickerProps) {
    const { t } = useTranslation()

    return (
        <div className={cn('flex items-center gap-1 px-1', props.className)}>
            {SESSION_CONTEXT_TAG_IDS.map((ctx) => {
                const isCurrent = props.currentContext === ctx
                const label = t(`sessions.context.${ctx}`)
                return (
                    <button
                        key={ctx}
                        type="button"
                        aria-label={label}
                        aria-pressed={isCurrent}
                        title={label}
                        className={cn(
                            chipBaseClass,
                            'min-w-8 px-1.5 sm:min-w-0 sm:px-2.5',
                            isCurrent ? chipSelectedClass : chipIdleClass
                        )}
                        onClick={() => {
                            props.onClose?.()
                            props.onSelect(isCurrent ? null : ctx)
                        }}
                    >
                        <span aria-hidden="true">{CONTEXT_EMOJI[ctx]}</span>
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                )
            })}
        </div>
    )
}
