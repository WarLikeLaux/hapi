import { useId, useLayoutEffect, useRef, useState } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'
import { ChoiceLabel } from './ChoiceLabel'
import type { AgentType } from './types'

export type ModelChoice = { agent: AgentType; value: string; label: string }

// Effort stays in the accessible name. The picker shows it only for Antigravity.
export function modelChoiceLabel(label: string, keepEffort = false): string {
    if (keepEffort) return label
    return label.replace(/\s+(?:\((?:minimal|low|medium|high|extra[ -]?high|xhigh|max|ultra)\)|(?:minimal|low|medium|high|extra[ -]?high|xhigh|max|ultra))$/i, '')
}

export function ModelChoices(props: {
    options: readonly ModelChoice[]
    singleRow?: boolean
    isLoading?: boolean
    agent: AgentType
    model: string
    isDisabled: boolean
    onSelect: (choice: ModelChoice) => void
}) {
    const { t } = useTranslation()
    const descriptionId = useId()
    const row = useRef<HTMLDivElement>(null)
    const measurement = useRef<HTMLDivElement>(null)
    const [visibleKeys, setVisibleKeys] = useState<string[] | null>(null)
    const key = (choice: ModelChoice) => `${choice.agent}:${choice.value}`
    const selectedKey = `${props.agent}:${props.model}`
    const signature = JSON.stringify(props.options.map(choice => [key(choice), choice.label]))
    useLayoutEffect(() => {
        if (!props.singleRow) { setVisibleKeys(null); return }
        const element = row.current
        const measuring = measurement.current
        if (!element || !measuring) return
        const fit = () => {
            const width = element.clientWidth
            if (!width) return
            const widths = Array.from(measuring.children).map(child => child.getBoundingClientRect().width)
            const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0
            const selected = props.options.findIndex(choice => key(choice) === selectedKey)
            const prefix: number[] = []
            let used = 0
            for (let index = 0; index < widths.length; index++) {
                const next = used + (prefix.length ? gap : 0) + widths[index]
                if (next > width) break
                prefix.push(index); used = next
            }
            if (selected !== -1 && !prefix.includes(selected)) {
                prefix.length = 0
                used = widths[selected]
                for (let index = 0; index < widths.length; index++) {
                    if (index === selected) continue
                    if (used + gap + widths[index] > width) break
                    prefix.push(index); used += gap + widths[index]
                }
                prefix.push(selected)
            }
            if (!prefix.length && props.options.length) prefix.push(0)
            const keys = prefix.map(index => key(props.options[index]))
            setVisibleKeys(previous => JSON.stringify(previous) === JSON.stringify(keys) ? previous : keys)
        }
        fit()
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
        observer?.observe(element)
        let mounted = true
        void document.fonts?.ready.then(() => { if (mounted) fit() })
        return () => { mounted = false; observer?.disconnect() }
    }, [props.singleRow, signature, selectedKey])
    const visible = props.singleRow && visibleKeys
        ? visibleKeys.flatMap(id => props.options.find(choice => key(choice) === id) ?? [])
        : props.options
    const choiceText = (choice: ModelChoice) => modelChoiceLabel(choice.label, choice.agent === 'agy')
    const chipClass = (choice: ModelChoice) => `inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)] disabled:opacity-50 ${key(choice) === selectedKey
        ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
        : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'}`
    if (!props.options.length && !props.isLoading) return null
    return (
        <section aria-label={t('newSession.model')} aria-busy={props.isLoading || undefined}
            title={props.singleRow ? t('newSession.popularModels.hint') : undefined}
            className="flex min-w-0 flex-col gap-2 p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3">
            <ChoiceLabel kind="model" />
            <div className="relative min-w-0 flex-1">
                {props.singleRow ? <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
                    <div ref={measurement} className="flex w-max gap-3">
                    {props.options.map(choice => <span key={key(choice)} className={chipClass(choice)}>
                        {props.singleRow ? <AgentFlavorIcon flavor={choice.agent} className="h-3.5 w-3.5 shrink-0" /> : null}
                        <span>{choiceText(choice)}</span>
                    </span>)}
                    </div>
                </div> : null}
                <div ref={row} className={`flex min-w-0 items-center gap-x-3 gap-y-2 ${props.singleRow ? 'flex-nowrap' : 'flex-wrap'}`}>
                {visible.map((choice, index) => {
                    const selected = props.agent === choice.agent && props.model === choice.value
                    return <button
                        key={`${choice.agent}:${choice.value}`}
                        type="button"
                        aria-pressed={selected}
                        aria-label={choice.label}
                        aria-describedby={`${descriptionId}-${index}`}
                        title={`${getFlavorLabel(choice.agent)} · ${choice.label}`}
                        disabled={props.isDisabled}
                        onClick={() => props.onSelect(choice)}
                        className={chipClass(choice)}
                    >
                        <span id={`${descriptionId}-${index}`} className="sr-only">{getFlavorLabel(choice.agent)}</span>
                        {props.singleRow ? <AgentFlavorIcon flavor={choice.agent} className="h-3.5 w-3.5 shrink-0" /> : null}
                        <span className="min-w-0 truncate">{choiceText(choice)}</span>
                    </button>
                })}
                    {props.isLoading ? <span role="status" className="text-xs text-[var(--app-hint)]">{t('newSession.model.loading')}</span> : null}
                </div>
            </div>
        </section>
    )
}
