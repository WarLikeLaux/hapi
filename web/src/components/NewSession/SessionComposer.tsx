import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getFlavorLabel, type LaunchSessionRequest, type LaunchSessionResult } from '@hapi/protocol'
import { NewSession, type SessionEditorState } from './index'
import { MachineSelector } from './MachineSelector'
import { ProjectDirectory } from './ProjectDirectory'
import { Button } from '@/components/ui/button'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { useSessions } from '@/hooks/queries/useSessions'
import { useLastUsedMachine } from '@/hooks/useLastUsedMachine'
import { getRecentProjectPaths } from '@/hooks/useRecentProjectPaths'
import { resolveDefaultMachineDirectory } from './defaults'
import { savePreferredLaunchSettings } from './preferences'
import { usesSharedPermissionModeState } from '@/lib/codexFamilyPermissionAgents'
import { useTranslation } from '@/lib/use-translation'
import { clearNewSessionFormDraft, type NewSessionFormDraft } from './newSessionFormDraft'

type Props = ComponentProps<typeof NewSession>
type Card = {
    id: string
    draft?: NewSessionFormDraft
    ownPrompt: boolean
    prompt: string
    directory?: string
    launch?: { machineId: string; input: LaunchSessionRequest }
    result?: LaunchSessionResult
}
type Composition = {
    mode: 'batch'
    machineId: string
    directory: string
    prompt: string
    placement: string
    groupName: string
    groupRequestId: string
    cards: Card[]
    browseTarget?: string
}
const control = 'min-h-10 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-normal text-[var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50'
const action = 'min-h-10 rounded-md px-3 py-2 text-sm hover:bg-[var(--app-secondary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50'
function newCard(): Card { return { id: crypto.randomUUID(), ownPrompt: false, prompt: '' } }

function Editor({ onChange, id, initialDraft, ...props }: Props & {
    id: string; initialDraft?: NewSessionFormDraft; onChange: (id: string, state: SessionEditorState) => void
}) {
    const [seed] = useState(initialDraft)
    const report = useCallback((state: SessionEditorState) => onChange(id, state), [id, onChange])
    return <NewSession {...props} editor={{ initialDraft: seed, disabled: Boolean(props.isLoading), onChange: report }} />
}

function loadComposition(groupId?: string): Composition | null {
    try {
        const saved = JSON.parse(sessionStorage.getItem(`hapi:session-composition:${groupId ?? 'standalone'}`) ?? 'null') as Composition | null
        if (saved?.mode === 'batch' && saved.cards?.length && saved.groupRequestId) return saved
    } catch { /* A fresh single-chat form remains available without browser storage. */ }
    return null
}

export function SessionComposer(props: Props) {
    const [importPi, setImportPi] = useState(false)
    const [singleSeed, setSingleSeed] = useState<{
        draft?: NewSessionFormDraft; directory: string; groupId?: string; groupName?: string
    } | null>(null)
    function clearBatch() {
        try { sessionStorage.removeItem(`hapi:session-composition:${props.groupId ?? 'standalone'}`) } catch { /* Optional draft. */ }
        clearNewSessionFormDraft()
        setBatchSeed(null)
    }
    const [batchSeed, setBatchSeed] = useState(() => loadComposition(props.groupId))
    function addAnotherChat(state: SessionEditorState) {
        const composition: Composition = {
            mode: 'batch', machineId: state.draft.machineId ?? '', directory: state.input.directory,
            prompt: '', placement: state.draft.groupId ?? (state.draft.groupCreation ? 'new' : 'none'),
            groupName: state.draft.groupCreation?.name ?? '',
            groupRequestId: state.draft.groupCreation?.requestId ?? crypto.randomUUID(),
            cards: [{ ...newCard(), draft: state.draft }, newCard()],
        }
        try { sessionStorage.setItem(`hapi:session-composition:${props.groupId ?? 'standalone'}`, JSON.stringify(composition)) } catch { /* Launch requires durable request identities later. */ }
        setBatchSeed(composition)
    }
    // Ordinary creation and continuation keep their existing form and launch flow.
    return props.continueFromSession ? <NewSession {...props} />
        : importPi ? <NewSession {...props} initialAgent="pi" onCancel={() => { setBatchSeed(loadComposition(props.groupId) ?? batchSeed); setImportPi(false) }} />
        : batchSeed ? <BatchComposer {...props} seed={batchSeed} onImportPi={() => setImportPi(true)}
            onCancel={() => { clearBatch(); props.onCancel() }}
            onSingleChat={seed => { clearBatch(); setSingleSeed(seed) }} />
        : <NewSession {...props} {...(singleSeed ? {
            initialDraft: singleSeed.draft, initialDirectory: singleSeed.directory,
            groupId: singleSeed.groupId, groupName: singleSeed.groupName,
            initialMachineId: singleSeed.draft?.machineId ?? props.initialMachineId,
        } : {})} onAddChat={addAnotherChat} />
}

function BatchComposer(props: Props & {
    seed: Composition
    onImportPi: () => void
    onSingleChat: (seed: { draft?: NewSessionFormDraft; directory: string; groupId?: string; groupName?: string }) => void
}) {
    const { t } = useTranslation()
    const client = useQueryClient()
    const groups = useSessionGroups(props.api)
    const { sessions } = useSessions(props.api)
    const { setLastUsedMachineId } = useLastUsedMachine()
    const storageKey = `hapi:session-composition:${props.groupId ?? 'standalone'}`
    const [composition, setComposition] = useState<Composition>(() => {
        const initial = props.seed
        if (initial.browseTarget && props.initialDirectory !== undefined) {
            const selected = initial.browseTarget === 'common'
                ? { ...initial, directory: props.initialDirectory }
                : { ...initial, cards: initial.cards.map(card => card.id === initial.browseTarget ? { ...card, directory: props.initialDirectory } : card) }
            delete selected.browseTarget
            return selected
        }
        return initial
    })
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => { rootRef.current?.scrollIntoView({ block: 'start' }) }, [])
    const compositionRef = useRef(composition)
    compositionRef.current = composition
    const [expanded, setExpanded] = useState(composition.cards[composition.cards.length - 1].id)
    const [prepared, setPrepared] = useState<Record<string, SessionEditorState>>({})
    const [busy, setBusy] = useState<Record<string, boolean>>({})
    const [preparing, setPreparing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [missingDirectories, setMissingDirectories] = useState<string[]>([])
    const inFlight = useRef(false)
    const singleCompleted = useRef(false)
    const activeLaunches = useRef(new Set<string>())
    const started = composition.cards.some(card => card.launch)
    const disabled = started || preparing || Boolean(props.isLoading)
    useEffect(() => {
        if (singleCompleted.current) return
        try { sessionStorage.setItem(storageKey, JSON.stringify(compositionRef.current)) } catch { /* Optional draft persistence. */ }
    }, [composition, storageKey])
    // Machines can arrive after the form mounts.
    useEffect(() => {
        if (started || !props.machines[0] || props.machines.some(machine => machine.id === composition.machineId)) return
        const machine = props.machines[0]
        setComposition(c => ({ ...c, machineId: machine.id,
            directory: (!c.machineId && c.directory) || resolveDefaultMachineDirectory(machine, getRecentProjectPaths(sessions, machine.id)) }))
    }, [composition.machineId, props.machines, sessions, started])
    const report = useCallback((id: string, state: SessionEditorState) => {
        setPrepared(current => JSON.stringify(current[id]) === JSON.stringify(state) ? current : { ...current, [id]: state })
        setComposition(c => {
            const card = c.cards.find(item => item.id === id)
            if (!card || card.launch || JSON.stringify(card.draft) === JSON.stringify(state.draft)) return c
            return { ...c, cards: c.cards.map(item => item.id === id ? { ...item, draft: state.draft } : item) }
        })
    }, [])
    function updateCard(id: string, patch: Partial<Card>) {
        setComposition(c => ({ ...c, cards: c.cards.map(card => card.id === id ? { ...card, ...patch } : card) }))
    }
    function persistForBrowse(target: string, directory: string) {
        const snapshot = { ...composition, browseTarget: target,
            cards: composition.cards.map(card => ({ ...card, draft: prepared[card.id]?.draft ?? card.draft })) }
        try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)) } catch { setError(t('batch.draftSaveFailed')); return }
        setComposition(snapshot)
        props.onChooseFolder?.({ machineId: composition.machineId, directory })
    }
    function directoryPicker(value: string, change: (value: string) => void, target: string, onUseCommon?: () => void) {
        return <ProjectDirectory api={props.api} machine={props.machines.find(m => m.id === composition.machineId)}
            sessions={sessions} value={value} disabled={disabled} compact={target !== 'common'} onChange={change}
            label={target !== 'common' ? t('batch.otherProject') : undefined}
            labelAction={onUseCommon ? <button type="button" className="min-h-8 text-xs underline underline-offset-4 disabled:opacity-50" disabled={disabled} onClick={onUseCommon}>{t('batch.useCommonProject')}</button> : undefined}
            onBrowse={props.onChooseFolder ? () => persistForBrowse(target, value) : undefined} />
    }
    async function launch(card: Card, retry: boolean) {
        if (activeLaunches.current.has(card.id)) return
        const request = card.launch!
        const input = retry ? { ...request.input, requestId: crypto.randomUUID() } : request.input
        if (retry) {
            const snapshot = { ...compositionRef.current, cards: compositionRef.current.cards.map(item => item.id === card.id
                ? { ...item, launch: { ...request, input }, result: { state: 'indeterminate' as const } } : item) }
            try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)) }
            catch { setError(t('batch.launchSaveFailed')); return }
            compositionRef.current = snapshot
            setComposition(snapshot)
        }
        activeLaunches.current.add(card.id)
        updateCard(card.id, { launch: { ...request, input }, result: { state: 'indeterminate' } })
        setBusy(b => ({ ...b, [card.id]: true }))
        try {
            const result = await props.api.launchSession(request.machineId, input)
            updateCard(card.id, { result })
            if (result.state === 'succeeded') {
                setLastUsedMachineId(request.machineId)
                if (card.draft) {
                    const draft = card.draft
                    savePreferredLaunchSettings(request.machineId, draft.agent, {
                        model: draft.model, cursorSelectedBase: draft.cursorSelectedBase,
                        effort: draft.effort, modelReasoningEffort: draft.modelReasoningEffort,
                        ...(usesSharedPermissionModeState(draft.agent) ? { permissionMode: draft.nativePermissionMode } : {}),
                    })
                }
            }
            if (composition.cards.length === 1 && result.state === 'succeeded' && result.sessionId) {
                singleCompleted.current = true
                try { sessionStorage.removeItem(storageKey) } catch { /* Optional draft. */ }
                props.onSuccess(result.sessionId, true)
            }
        } catch (e) {
            updateCard(card.id, { result: { state: 'indeterminate', message: e instanceof Error ? e.message : String(e) } })
        } finally {
            activeLaunches.current.delete(card.id)
            setBusy(b => ({ ...b, [card.id]: false }))
            void client.invalidateQueries({ queryKey: ['sessions'] })
            void client.invalidateQueries({ queryKey: ['session-groups'] })
        }
    }
    async function start(confirmDirectories = false) {
        if (inFlight.current || started) return
        inFlight.current = true
        setPreparing(true)
        setError(null)
        try {
            const paths = [...new Set(composition.cards.map(card => (card.directory ?? composition.directory).trim()))]
            const checked = await props.api.checkMachinePathsExists(composition.machineId, paths)
            if (checked.outsideWorkspaceRoots?.length) throw new Error(t('newSession.directoryOutsideWorkspaceRoots'))
            const missing = paths.filter(path => checked.exists[path] === false)
            if (missing.length && (!confirmDirectories || !missing.every(path => missingDirectories.includes(path)))) { setMissingDirectories(missing); return }
            let groupId = composition.placement === 'none' ? undefined : composition.placement
            if (groupId === 'new') {
                const response = await props.api.createGroup(composition.groupName.trim(), composition.groupRequestId)
                groupId = response.group.id
            }
            const cards = composition.cards.map(card => ({ ...card, draft: prepared[card.id].draft,
                launch: { machineId: composition.machineId, input: { ...prepared[card.id].input,
                    directory: (card.directory ?? composition.directory).trim(), groupId,
                    initialPrompt: card.ownPrompt && card.prompt.trim() ? card.prompt : composition.prompt, requestId: crypto.randomUUID() } },
                result: { state: 'indeterminate' as const } }))
            // Save every request identity synchronously before the first network dispatch.
            // A response or page can be lost before React has flushed its persistence effect.
            const snapshot = { ...composition, cards }
            try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)) }
            catch { throw new Error(t('batch.launchSaveFailed')) }
            compositionRef.current = snapshot
            setComposition(snapshot)
            setExpanded('')
            setMissingDirectories([])
            await Promise.allSettled(cards.map(card => launch(card, false)))
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally { inFlight.current = false; setPreparing(false) }
    }
    const groupMissing = !['none', 'new'].includes(composition.placement) && !groups.query.isPending
        && !groups.query.isError && !groups.groups.some(group => group.id === composition.placement)
    const canStart = !groupMissing && composition.cards.every(card => prepared[card.id]?.canCreate)
        && Boolean(composition.machineId && composition.directory.trim())
        && (composition.placement !== 'new' || Boolean(composition.groupName.trim()))
        && !disabled
    const successCount = composition.cards.filter(card => card.result?.state === 'succeeded').length
    const failureCount = composition.cards.filter(card => card.result?.state === 'failed').length
    function openSession(id: string) {
        props.onSuccess(id, true)
    }
    return <div ref={rootRef} className="w-full">
        {!started ? <div className="border-b border-[var(--app-divider)] px-3 py-2"><button type="button" className={`${action} -ml-3 inline-flex items-center gap-1.5 text-[var(--app-hint)]`} disabled={disabled} onClick={() => {
            const first = composition.cards[0]
            const draft = prepared[first.id]?.draft ?? first.draft
            // Leaving batch mode is explicit. Keep the first chat's settings and placement.
            singleCompleted.current = true
            props.onSingleChat({
                draft: draft ? { ...draft, groupId: undefined, groupCreation: composition.placement === 'new'
                    ? { name: composition.groupName, requestId: composition.groupRequestId } : undefined } : undefined,
                directory: first.directory ?? composition.directory,
                groupId: ['none', 'new'].includes(composition.placement) ? undefined : composition.placement,
                groupName: groups.groups.find(group => group.id === composition.placement)?.name,
            })
        }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 19-7-7 7-7M5 12h14" /></svg>{t('batch.singleChat')}</button></div> : null}
        <details open={!started}>
            <summary className={started ? `${action} cursor-pointer text-[var(--app-hint)]` : 'hidden'}>{t('batch.launchSettings')}</summary>
        <section className="flex flex-col divide-y divide-[var(--app-divider)] [&>div]:pr-[10px] lg:[&>div]:pr-3" aria-label={t('batch.sharedSettings')}>
            {props.groupDefaultsUnavailable ? <p role="status" className="px-3 py-2 text-xs text-[var(--app-hint)]">{t('groups.defaultsUnavailable')}</p> : null}
            <div className="space-y-3 px-3 py-3">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--app-hint)]">
                    <span>{t('batch.placement')}</span>
                    <select className={control} value={composition.placement} disabled={disabled || groups.query.isPending || groups.query.isError}
                        onChange={e => setComposition(c => ({ ...c, placement: e.target.value }))}>
                        <option value="none">{t('batch.noGroup')}</option><option value="new">{t('batch.newGroup')}</option>
                        {groups.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                </label>
                {groupMissing ? <p role="alert" className="text-sm text-red-600">{t('groups.loadError')}</p> : null}
                {groups.query.isError ? <p role="alert" className="text-sm text-red-600">{t('groups.loadError')} <button className="underline" onClick={() => void groups.query.refetch()}>{t('button.retry')}</button></p> : null}
                {composition.placement === 'new' ? <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--app-hint)]"><span>{t('groups.name')}</span>
                    <input className={control} value={composition.groupName} maxLength={120} disabled={disabled}
                        onChange={e => setComposition(c => ({ ...c, groupName: e.target.value, groupRequestId: crypto.randomUUID() }))} /></label> : null}
            </div>
            {props.machines.length > 1 ? <MachineSelector machines={props.machines} machineId={composition.machineId} isLoading={props.isLoading}
                isDisabled={disabled} onChange={machineId => {
                    const machine = props.machines.find(m => m.id === machineId)!
                    setComposition(c => ({ ...c, machineId, directory: resolveDefaultMachineDirectory(machine, getRecentProjectPaths(sessions, machineId)) }))
                }} /> : null}
            {directoryPicker(composition.directory, directory => { setComposition(c => ({ ...c, directory })); setMissingDirectories([]) }, 'common')}
            <div className="space-y-1.5 px-3 py-3">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--app-hint)]">
                    <span>{t('batch.commonPrompt')}</span>
                    <textarea className={`${control} min-h-24 resize-y`} rows={3} maxLength={100000} value={composition.prompt} disabled={disabled}
                        placeholder={t('batch.promptPlaceholder')} onChange={e => setComposition(c => ({ ...c, prompt: e.target.value }))} />
                </label>
                <p className="text-xs text-[var(--app-hint)]">{t('batch.promptHint')}</p>
            </div>
        </section>
        </details>
        <section className="border-t border-[var(--app-divider)]" aria-label={t('batch.chats')}>
            <div className="flex items-center justify-between gap-2 px-3 py-3"><h2 className="text-base font-semibold">{t('batch.chats')} <span className="text-[var(--app-hint)]">{composition.cards.length}</span></h2>
                {!started ? <button className={`${action} border border-[var(--app-border)]`} disabled={disabled} onClick={() => {
                    const card = newCard(); setComposition(c => ({ ...c, cards: [...c.cards, card] })); setExpanded(card.id)
                }}>{t('batch.add')}</button> : null}</div>
            {composition.cards.map((card, index) => {
                const state = prepared[card.id]
                const agent = card.launch?.input.agent ?? state?.input.agent
                const prompt = card.ownPrompt && card.prompt.trim() ? card.prompt : composition.prompt
                const isExpanded = expanded === card.id
                return <article key={card.id} className="min-w-0 border-t border-[var(--app-divider)]" aria-label={t('batch.chatNumber', { count: index + 1 })}>
                    <div className="flex items-start gap-2 p-3">
                        {agent ? <AgentFlavorIcon flavor={agent} className="mt-1 h-5 w-5 shrink-0" /> : null}
                        <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--app-link)]" disabled={started} aria-expanded={started ? undefined : isExpanded} aria-controls={started ? undefined : `editor-${card.id}`}
                            onClick={() => setExpanded(isExpanded ? '' : card.id)}>
                            <span className="block text-sm font-semibold">{t('batch.chatNumber', { count: index + 1 })}{agent ? ` · ${getFlavorLabel(agent)}` : ''}</span>
                            <span className="mt-1 block break-words text-xs text-[var(--app-hint)]">{state?.modelLabel ?? t('loading')}</span>
                            <span className="mt-1 block break-all text-xs text-[var(--app-hint)]">{card.directory ?? composition.directory}</span>
                        </button>
                        {!started ? <div className="flex shrink-0 items-center gap-1">
                            <button className={action} disabled={disabled || !state} aria-label={`${t('batch.duplicate')} ${index + 1}`} onClick={() => {
                                const copy = { ...card, id: crypto.randomUUID(), draft: state?.draft }
                                setComposition(c => ({ ...c, cards: [...c.cards, copy] })); setExpanded(copy.id)
                            }}>{t('batch.duplicate')}</button>
                            {composition.cards.length > 1 ? <button className={action} disabled={disabled} aria-label={`${t('batch.remove')} ${index + 1}`} onClick={() => setComposition(c => ({ ...c, cards: c.cards.filter(item => item.id !== card.id) }))}>
                                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
                            </button> : null}
                        </div> : null}
                    </div>
                    {prompt.trim() && (!isExpanded || started) ? <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-sm">{prompt}</p> : null}
                    <div id={`editor-${card.id}`} hidden={!isExpanded || started}>
                        <div className="border-t border-[var(--app-divider)]">
                            <Editor {...props} id={card.id} groupId={undefined} initialMachineId={composition.machineId}
                                initialDirectory={card.directory ?? composition.directory} initialDraft={card.draft}
                                isLoading={disabled} onChange={report} onChooseFolder={undefined} />
                        </div>
                        {agent === 'pi' && composition.cards.length === 1 ? <button className={`${action} m-3 border border-[var(--app-border)]`} disabled={disabled} onClick={props.onImportPi}>{t('piImport.inline.choose')}</button> : null}
                        <div className="space-y-3 border-t border-[var(--app-divider)] p-3">
                            <div className="space-y-1.5"><label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--app-link)]" checked={card.ownPrompt} disabled={disabled}
                                onChange={e => updateCard(card.id, { ownPrompt: e.target.checked })} />{t('batch.useOwn')}</label>
                            {card.ownPrompt ? <div className="space-y-1.5">
                                <textarea className={`${control} min-h-24 resize-y`} rows={3} maxLength={100000} aria-label={t('batch.ownPrompt')}
                                    value={card.prompt} disabled={disabled} placeholder={t('batch.replaces')} onChange={e => updateCard(card.id, { prompt: e.target.value })} /><p className="text-xs text-[var(--app-hint)]">{t('batch.emptyOwnHint')}</p></div> : null}</div>
                            {card.directory === undefined ? <button className={`${action} -ml-3 underline underline-offset-4`} disabled={disabled}
                                onClick={() => updateCard(card.id, { directory: composition.directory })}>{t('batch.otherProject')}</button>
                                : <div className="-mx-3">{directoryPicker(card.directory, directory => updateCard(card.id, { directory }), card.id, () => updateCard(card.id, { directory: undefined }))}</div>}
                        </div>
                    </div>
                    {card.result ? <div className="space-y-2 border-t border-[var(--app-divider)] p-3 text-sm" role="status">
                        <p className={card.result.state === 'failed' ? 'text-red-600' : ''}>{busy[card.id] ? t('batch.launching') : t(`batch.${card.result.state}`)}</p>
                        {!busy[card.id] && card.result.message ? <p className="break-words text-xs text-[var(--app-hint)]">{card.result.message}</p> : null}
                        {!busy[card.id] && card.result.state === 'indeterminate' ? <p className="text-xs text-[var(--app-hint)]">{t('batch.unknownHint')}</p> : null}
                        <div className="flex flex-wrap gap-2">
                            {!busy[card.id] && card.result.state !== 'succeeded' ? <button className={`${action} border border-[var(--app-border)]`} onClick={() => void launch(card, card.result?.state === 'failed')}>
                                {card.result.state === 'failed' ? t('batch.retryChat') : t('batch.checkResult')}</button> : null}
                            {card.result.sessionId ? <button className={`${action} underline`} onClick={() => openSession(card.result!.sessionId!)}>{t('batch.openChat')}</button> : null}
                        </div>
                    </div> : null}
                </article>
            })}
        </section>
        {error ? <p role="alert" className="px-3 py-2 text-sm text-red-600">{error}</p> : null}
        {missingDirectories.length ? <div className="space-y-2 px-3 py-3 text-sm" role="alert"><p>{t('batch.createDirectories')}</p>
            {missingDirectories.map(path => <p key={path} className="break-all text-xs">{path}</p>)}
            <button className={`${action} border border-[var(--app-border)]`} disabled={preparing} onClick={() => void start(true)}>{t('batch.confirmDirectories')}</button>
        </div> : null}
        <div className="sticky bottom-0 pr-[10px] lg:pr-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--app-border)] bg-[var(--app-bg)] px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {started ? <><button className={action} disabled={Object.values(busy).some(Boolean)} onClick={() => {
                setComposition(c => ({ ...c, cards: [newCard()], groupRequestId: crypto.randomUUID() }))
                setExpanded('')
            }}>{t('batch.prepareMore')}</button><p className="text-sm">{t('batch.results', { success: successCount, total: composition.cards.length })}</p>
                {failureCount ? <button className={`${action} border border-[var(--app-border)]`} disabled={Object.values(busy).some(Boolean)} onClick={() => void Promise.allSettled(composition.cards.filter(card => card.result?.state === 'failed').map(card => launch(card, true)))}>{t('batch.retryFailed', { count: failureCount })}</button> : null}</>
                : <><Button variant="secondary" disabled={preparing} onClick={() => { singleCompleted.current = true; props.onCancel() }}>{t('button.cancel')}</Button>
                    <Button disabled={!canStart || groups.query.isPending || groups.query.isError}
                        onClick={() => void start()}>{preparing ? t('batch.launching') : composition.cards.length === 1 ? t('batch.launchOne') : t('batch.launchCount', { count: composition.cards.length })}</Button></>}
        </div>
    </div>
}
