import { useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useTranslation } from '@/lib/use-translation'

function PlacementIcon({ value }: { value: string }) {
    return <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--app-hint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {value === 'none' ? <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
            : value === 'new' ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 12h8m-4-4v8" /></>
                : <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M9 9v11" /></>}
    </svg>
}

/** Group placement uses the same popover and keyboard conventions as group tabs. */
export function PlacementPicker({ value, groups, disabled, pending, onChange }: {
    value: string
    groups: readonly { id: string; name: string }[]
    disabled: boolean
    pending?: boolean
    onChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    useEffect(() => { if (disabled) setOpen(false) }, [disabled])
    const labelId = useId()
    const selectionId = useId()
    const triggerId = useId()
    const menu = useRef<HTMLDivElement>(null)
    const options = [
        { value: 'none', label: t('batch.noGroup') },
        { value: 'new', label: t('batch.newGroup') },
        ...groups.map(group => ({ value: group.id, label: group.name })),
    ]
    const selected = options.find(option => option.value === value)
    return <div className="flex flex-col gap-1.5">
        <label id={labelId} htmlFor={triggerId} className="text-xs font-medium text-[var(--app-hint)]">{t('batch.placement')}</label>
        <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button id={triggerId} type="button" disabled={disabled} aria-haspopup="menu" aria-labelledby={`${labelId} ${selectionId}`}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-left text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] data-[state=open]:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50"
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
                    }}>
                    <PlacementIcon value={value} />
                    <span id={selectionId} className="min-w-0 flex-1 truncate">{selected?.label ?? t(pending ? 'loading' : 'groups.loadError')}</span>
                    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--app-hint)] transition-transform data-[open=true]:rotate-180" data-open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content ref={menu} role="menu" aria-labelledby={labelId} side="bottom" align="start" sideOffset={6} collisionPadding={12}
                    className="z-50 max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1.5 text-[var(--app-fg)] shadow-lg"
                    onOpenAutoFocus={event => {
                        event.preventDefault()
                        const current = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
                            ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
                        current?.focus()
                        current?.scrollIntoView({ block: 'nearest' })
                    }}
                    onKeyDown={event => {
                        event.stopPropagation()
                        if (event.key === 'Tab') { setOpen(false); return }
                        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
                        const current = items.findIndex(item => item === document.activeElement)
                        let next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                            : event.key === 'ArrowDown' ? (current + 1) % items.length
                                : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length : -1
                        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
                            next = items.findIndex((_, offset) => options[(current + 1 + offset) % items.length].label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
                            if (next >= 0) next = (current + 1 + next) % items.length
                        }
                        if (next >= 0) { event.preventDefault(); items[next]?.focus(); items[next]?.scrollIntoView({ block: 'nearest' }) }
                    }}>
                    {options.map((option, index) => <div key={option.value} className={index === 2 ? 'mt-1 border-t border-[var(--app-divider)] pt-1' : undefined}>
                        <button type="button" role="menuitemradio" aria-checked={option.value === value}
                            className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] aria-checked:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]"
                            onClick={() => { onChange(option.value); setOpen(false) }}>
                            <PlacementIcon value={option.value} /><span className="min-w-0 flex-1 break-words">{option.label}</span>
                            {option.value === value ? <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--app-link)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg> : null}
                        </button>
                    </div>)}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    </div>
}
