import { useEffect, useRef, useState } from 'react'
import type { ModelPreference } from '@/api/client'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType } from './types'

type ModelOption = { value: string; label: string }

function ModelRow(props: {
    agent: AgentType
    option: ModelOption
    preference?: ModelPreference
    index: number
    count: number
    shown: boolean
    onSave: (preference: ModelPreference) => Promise<void>
    effortOptions?: string[]
    supportsSpeed: boolean
    onRemove: (id: string) => void
    onMove: (id: string, direction: -1 | 1) => void
}) {
    const { t } = useTranslation()
    const [alias, setAlias] = useState(props.preference?.alias ?? '')
    const cancelBlur = useRef(false)
    useEffect(() => setAlias(props.preference?.alias ?? ''), [props.preference?.alias])
    const save = (pinned: boolean, hidden: boolean) => props.onSave({
        agent: props.agent, modelId: props.option.value, pinned, hidden, alias: alias.trim() || null, reasoningEffort: props.preference?.reasoningEffort ?? null, speed: props.preference?.speed ?? null, showInAll: props.preference?.showInAll ?? true
    })
    const control = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-30'
    return <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--app-divider)] px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-2 sm:px-2 sm:py-2">
        <div className="flex min-w-0 items-center gap-1 sm:flex-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--app-fg)] sm:order-last sm:pl-1 sm:text-xs" title={props.option.value}>{props.option.label}</span>
        {props.shown ? <>
            <button type="button" className={control} disabled={props.index === 0} aria-label={t('newSession.models.moveUp', { model: props.option.label })} onClick={() => props.onMove(props.option.value, -1)}>↑</button>
            <button type="button" className={control} disabled={props.index === props.count - 1} aria-label={t('newSession.models.moveDown', { model: props.option.label })} onClick={() => props.onMove(props.option.value, 1)}>↓</button>
            <button type="button" className={control} disabled={props.count <= 1} aria-label={t('newSession.models.remove', { model: props.option.label })} onClick={() => { void save(false, true); props.onRemove(props.option.value) }}>×</button>
        </> : <button type="button" className={control} aria-label={t('newSession.models.addNamed', { model: props.option.label })} onClick={() => void save(true, false)}>+</button>}
        </div>
        <div className="grid min-w-0 grid-cols-2 items-center gap-2 sm:flex sm:shrink-0">
        {props.effortOptions ? <div className="relative min-w-0 sm:w-24">
            <select aria-label={t('newSession.models.effortFor', { model: props.option.label })}
                value={props.preference?.reasoningEffort ?? ''} onChange={event => void props.onSave({
                    agent: props.agent, modelId: props.option.value, pinned: props.preference?.pinned ?? false,
                    hidden: props.preference?.hidden ?? false, alias: alias.trim() || null, reasoningEffort: event.target.value || null, speed: props.preference?.speed ?? null, showInAll: props.preference?.showInAll ?? true
                })} className="w-full appearance-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-2 pr-6 text-xs text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]">
                <option value="">{t('newSession.effort')}</option>
                {props.effortOptions.map(value => <option key={value} value={value}>{value === 'xhigh' ? 'XHigh' : value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
            </select>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--app-hint)]"><path d="m4 6 4 4 4-4" /></svg>
        </div> : null}
        {props.supportsSpeed ? <select aria-label={t('newSession.models.speedFor', { model: props.option.label })}
            value={props.preference?.speed ?? ''} onChange={event => void props.onSave({
                agent: props.agent, modelId: props.option.value, pinned: props.preference?.pinned ?? false,
                hidden: props.preference?.hidden ?? false, alias: alias.trim() || null,
                reasoningEffort: props.preference?.reasoningEffort ?? null,
                speed: (event.target.value || null) as ModelPreference['speed'], showInAll: props.preference?.showInAll ?? true
            })} className="w-full min-w-0 sm:w-24 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)]">
            <option value="">{t('newSession.speed')}</option>
            <option value="standard">{t('misc.fastModeStandard')}</option>
            <option value="fast">{t('misc.fastModeFast')}</option>
        </select> : null}
        {props.shown ? <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-[var(--app-fg)] sm:shrink-0">
            <input type="checkbox" className="peer sr-only" aria-label={t('newSession.models.showInAllFor', { model: props.option.label })}
                checked={props.preference?.showInAll !== false} onChange={event => void props.onSave({
                    agent: props.agent, modelId: props.option.value, pinned: props.preference?.pinned ?? false,
                    hidden: props.preference?.hidden ?? false, alias: alias.trim() || null,
                    reasoningEffort: props.preference?.reasoningEffort ?? null, speed: props.preference?.speed ?? null,
                    showInAll: event.target.checked
                })} />
            <span aria-hidden="true" className="relative h-5 w-9 shrink-0 rounded-full bg-[var(--app-border)] transition-colors peer-checked:bg-[var(--app-link)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--app-link)] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
            <span>{t('newSession.models.showInAll')}</span>
        </label> : null}
        <input aria-label={t('newSession.models.aliasFor', { model: props.option.label })} placeholder={t('newSession.models.alias')} maxLength={80} value={alias}
            onChange={event => setAlias(event.target.value)} onBlur={() => {
                if (cancelBlur.current) { cancelBlur.current = false; return }
                if (alias.trim() !== (props.preference?.alias ?? '')) void save(props.preference?.pinned ?? false, props.preference?.hidden ?? false)
            }}
            onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') { cancelBlur.current = true; setAlias(props.preference?.alias ?? ''); event.currentTarget.blur() }
            }}
            className="w-full min-w-0 sm:w-40 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]" />
        </div>
    </div>
}

export function ModelManager(props: {
    agent: AgentType
    options: ModelOption[]
    shown: ModelOption[]
    preferences: ModelPreference[]
    getEffortOptions?: (id: string) => string[]
    supportsSpeed?: (id: string) => boolean
    error: string | null
    onSave: (preference: ModelPreference) => Promise<void>
    onReorder: (agent: AgentType, ids: string[]) => Promise<void>
    onRemove: (id: string) => void
}) {
    const { t } = useTranslation()
    const [search, setSearch] = useState('')
    const [newId, setNewId] = useState('')
    const [selectedId, setSelectedId] = useState('')
    const shownIds = props.shown.map(option => option.value)
    const options = [...props.shown, ...props.options].filter((option, index, all) =>
        all.findIndex(candidate => candidate.value === option.value) === index)
    const visible = options.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(search.toLowerCase()))
    const available = options.filter(option => !shownIds.includes(option.value))
    const candidateId = selectedId === '__custom__' ? newId.trim() : selectedId
    const move = (id: string, direction: -1 | 1) => {
        const index = shownIds.indexOf(id)
        const target = index + direction
        if (index < 0 || target < 0 || target >= shownIds.length) return
        const next = [...shownIds]
        ;[next[index], next[target]] = [next[target], next[index]]
        void props.onReorder(props.agent, next)
    }
    return <div className="mx-3 mt-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-2">
        <p className="mb-2 px-1 text-xs text-[var(--app-hint)]">{t('newSession.models.hint')}</p>
        <div className="mb-2 flex gap-2">
            <select aria-label={t('newSession.models.choose')} value={selectedId} onChange={event => setSelectedId(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]">
                <option value="">{t('newSession.models.choose')}</option>
                {available.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                <option value="__custom__">{t('newSession.models.custom')}</option>
            </select>
            <button type="button" disabled={!candidateId} className="rounded-lg border border-[var(--app-border)] px-3 text-xs disabled:opacity-40" onClick={() => {
                const id = candidateId
                if (!id) return
                const previous = props.preferences.find(row => row.agent === props.agent && row.modelId === id)
                void props.onSave({ agent: props.agent, modelId: id, pinned: true, hidden: false, alias: previous?.alias ?? null, reasoningEffort: previous?.reasoningEffort ?? null, speed: previous?.speed ?? null, showInAll: previous?.showInAll ?? true })
                setNewId('')
                setSelectedId('')
            }}>{t('newSession.models.add')}</button>
        </div>
        {selectedId === '__custom__' ? <input aria-label={t('newSession.models.newId')} placeholder={t('newSession.models.newId')} value={newId} maxLength={256} onChange={event => setNewId(event.target.value)}
            className="mb-2 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]" /> : null}
        <input aria-label={t('newSession.models.search')} placeholder={t('newSession.models.search')} value={search} onChange={event => setSearch(event.target.value)}
            className="mb-2 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]" />
        <div className="max-h-64 overflow-y-auto rounded-lg bg-[var(--app-bg)]">
            {visible.map(option => <ModelRow key={`${props.agent}:${option.value}`} agent={props.agent} option={option}
                preference={props.preferences.find(row => row.agent === props.agent && row.modelId === option.value)}
                effortOptions={props.getEffortOptions?.(option.value)} supportsSpeed={props.supportsSpeed?.(option.value) ?? false}
                shown={shownIds.includes(option.value)} index={shownIds.indexOf(option.value)} count={shownIds.length}
                onSave={props.onSave} onRemove={props.onRemove} onMove={move} />)}
            {visible.length === 0 ? <p className="px-3 py-2 text-xs text-[var(--app-hint)]">{t('newSession.models.noResults')}</p> : null}
        </div>
        {props.error ? <p role="alert" className="pt-2 text-xs text-red-600">{t(props.error)}</p> : null}
    </div>
}
