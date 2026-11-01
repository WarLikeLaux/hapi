import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'

export function EffortChips(props: {
    options: Array<{ value: string; label: string }>
    value: string
    disabled: boolean
    onChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const selectedIndex = props.options.findIndex(option => option.value === props.value)
    const visibleOnMobile = (index: number, limit: number) => index < limit - (selectedIndex >= limit ? 1 : 0) || index === selectedIndex
    const buttonClass = (selected: boolean) => `rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50 ${selected
        ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
        : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'}`
    return <div className="relative flex min-w-0 flex-1 flex-wrap gap-2 sm:gap-3" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
        {props.options.map((option, index) => <button key={option.value} type="button"
            aria-pressed={props.value === option.value} disabled={props.disabled}
            onClick={() => props.onChange(option.value)}
            className={`${buttonClass(props.value === option.value)} ${visibleOnMobile(index, 3) ? '' : 'max-sm:hidden'} ${visibleOnMobile(index, 2) ? '' : 'max-[359px]:hidden'} sm:inline-flex`}>
            {option.label}
        </button>)}
        {props.options.length > 2 ? <div className={props.options.length === 3 ? 'relative min-[360px]:hidden' : 'relative sm:hidden'}>
            <button type="button" aria-label={t('chat.message.showMore')} aria-expanded={open} disabled={props.disabled}
                onClick={() => setOpen(value => !value)} className={buttonClass(false)}>…</button>
            {open ? <div className="absolute right-0 top-full z-20 mt-1 flex min-w-28 flex-col gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2 shadow-lg">
                {props.options.map(option => <button key={option.value} type="button" aria-pressed={props.value === option.value}
                    className={`${buttonClass(props.value === option.value)} ${visibleOnMobile(props.options.indexOf(option), 3) ? 'min-[360px]:hidden' : ''} ${visibleOnMobile(props.options.indexOf(option), 2) ? 'max-[359px]:hidden' : ''}`} onClick={() => { props.onChange(option.value); setOpen(false) }}>
                    {option.label}
                </button>)}
            </div> : null}
        </div> : null}
    </div>
}
