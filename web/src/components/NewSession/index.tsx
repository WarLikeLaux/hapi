import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { CodexDuplicateSessionGroup, CodexLocalSessionSummary, Machine, PiLocalSessionSummary, Session } from '@/types/api'
import { isKnownFlavor, isRemovedAgyModel, resolveHapiYoloPermissionMode, type CodexCollaborationMode, type GrokPermissionMode, type PermissionMode, type CopilotAgentMode } from '@hapi/protocol'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { usePlatform } from '@/hooks/usePlatform'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useCursorModelsForMachine } from '@/hooks/queries/useCursorModelsForMachine'
import { useAgyModels } from '@/hooks/queries/useAgyModels'
import { useOpencodeModelsForCwd } from '@/hooks/queries/useOpencodeModelsForCwd'
import { useOpencodeModelVariants } from '@/hooks/queries/useOpencodeModelVariants'
import { useGrokModelsForCwd } from '@/hooks/queries/useGrokModelsForCwd'
import { useCopilotModelsForCwd } from '@/hooks/queries/useCopilotModelsForCwd'
import { useKimiModelsForCwd } from '@/hooks/queries/useKimiModelsForCwd'
import { usePiModelsForMachine } from '@/hooks/queries/usePiModelsForMachine'
import { useAgentAvailability } from '@/hooks/queries/useAgentAvailability'
import { useSessions } from '@/hooks/queries/useSessions'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import {
    getMatchingDirectoryPaths,
    resolveDirectorySearchTarget,
    useDirectorySuggestions
} from '@/hooks/useDirectorySuggestions'
import { useLastUsedMachine } from '@/hooks/useLastUsedMachine'
import { getRecentProjectPaths } from '@/hooks/useRecentProjectPaths'
import { useProjectPaths } from '@/hooks/useProjectPaths'
import { useSessionContextFilter } from '@/hooks/useSessionContextFilter'
import { useSessionContextHubSync } from '@/hooks/useSessionContextHubSync'
import { useTranslation } from '@/lib/use-translation'
import { getClaudeGlmBranded, useClaudeGlmBranding } from '@/lib/claudeGlmBranding'
import { getCodexModelReasoningEfforts, resolveCodexModel } from '@/lib/codexModelCapabilities'
import {
    buildNewSessionCursorModelCatalog,
    buildNewSessionCursorPickerState,
    CURSOR_COMPOSER_STANDARD_WIRE,
    CURSOR_GROK_XHIGH_WIRE,
    getCursorModelSpeedOptions,
    isCursorEffortWireAllowed,
    isHardcodedCursorModelId,
    resolveCursorBaseFromWire,
    resolveNewSessionCursorBaseSelectValue,
    resolveNewSessionCursorEffortSelectValue,
    resolveWireIdForBaseChange,
    shouldShowCursorModelsUnavailable
} from './newSessionCursorModels'
import { buildCursorEffortPickerOptions, resolveCursorVariantOptions } from '@/lib/cursorModelOptions'
import {
    clearNewSessionFormDraft,
    loadNewSessionFormDraft,
    newSessionDraftMatchesMachine,
    saveNewSessionFormDraft,
    shouldRestoreNewSessionFormDraft
} from './newSessionFormDraft'
import { isOpencodeReasoningEffortValid, MODEL_OPTIONS } from './types'
import type { AgentType, LaunchEffort, CodexReasoningEffort, NewSessionServiceTier, SessionType } from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { PiImportActions } from './PiImportActions'
import { clearBatchImportedCodexSelection, resolveCodexImportRedirectSessionId } from './codexImportMerge'
import { AgyModelSelector } from './AgyModelSelector'
import { DirectorySection } from './DirectorySection'
import { CopilotAgentModeSelector } from './CopilotAgentModeSelector'
import { FastModeSelector } from './FastModeSelector'
import { MachineSelector } from './MachineSelector'
import { ModelSelector } from './ModelSelector'
import { OpencodeModelSelector } from './OpencodeModelSelector'
import { EffortField } from './EffortField'
import { shouldEnableOpencodeModelDiscovery } from './opencodeModelsGate'
import { buildGrokEffortOptions, buildGrokModelOptions, shouldEnableGrokModelDiscovery } from './grokModels'
import { buildKimiModelOptions, shouldEnableKimiModelDiscovery } from './grokModels'
import { groupModelsByProvider } from '@/components/AssistantChat/piModelGroups'
import { isThinkingLevelSupported } from '@/components/AssistantChat/piThinkingLevelOptions'
import {
    loadPreferredAgent,
    loadPreferredLaunchSettings,
    loadPreferredYoloMode,
    resolvePreferredLaunchSettings,
    savePreferredAgent,
    savePreferredLaunchSettings,
    savePreferredYoloMode,
} from './preferences'
import {
    AGY_HARDCODED_LABEL,
    AGY_HIGH_MODEL_ID,
    AGY_HIGH_MODEL_LABEL,
    CLAUDE_GLM_HARDCODED_LABEL,
    CLAUDE_GLM_MODEL_ID,
    CLAUDE_GLM_MODEL_LABEL,
    CODEX_DEFAULT_MODEL_ID,
    CODEX_HARDCODED_OPTIONS,
    MINIMAX_HARDCODED_LABEL,
    OPENCODE_HARDCODED_OPTIONS,
} from './hardcodedModels'
import { orderCreateSessionAgents, resolveDefaultMachineDirectory } from './defaults'
import { usesNativePermissionSelect, usesSharedPermissionModeState } from '@/lib/codexFamilyPermissionAgents'
import { CodexSessionSyncDialog } from '@/components/CodexSessionSyncDialog'
import { PiSessionImportDialog } from '@/components/PiSessionImportDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatRunnerSpawnError } from '../../utils/formatRunnerSpawnError'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { useToast } from '@/lib/toast-context'
import { buildSessionReferenceText } from '@/lib/sessionReference'
import { getSessionTitle } from '@/lib/sessionTitle'
import { makeClientSideId } from '@/lib/messages'

function QuickPickChips(props: {
    options: Array<{ value: string; label: string }>
    activeValue: string | null
    isDisabled: boolean
    onToggle: (value: string) => void
}) {
    return (
        <div className="contents">
            {props.options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    aria-pressed={props.activeValue === option.value}
                    disabled={props.isDisabled}
                    onClick={() => props.onToggle(option.value)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                        props.activeValue === option.value
                            ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
                            : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                    }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    )
}
// Quick model choices shown before the optional full catalog dropdown.
function ModelBadges(props: {
    label?: string
    options: Array<{ value: string; label: string }>
    activeValue: string | null
    isDisabled: boolean
    onToggle: (value: string) => void
    footer?: ReactNode
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <span className="text-xs font-medium text-[var(--app-hint)]">
                {props.label ?? t('newSession.model')}
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                <QuickPickChips
                    options={props.options}
                    activeValue={props.activeValue}
                    isDisabled={props.isDisabled}
                    onToggle={props.onToggle}
                />
                {props.footer}
            </div>
        </div>
    )
}

// Escape hatch behind the hardcoded badges: reveals the full catalog
// selector for the day a hardcoded wire goes stale.
function OtherModelsButton(props: {
    isDisabled: boolean
    onClick: () => void
}) {
    const { t } = useTranslation()
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.isDisabled}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2.5 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50"
        >
            {t('newSession.model.loadOptions')}
            <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
    )
}



export function NewSession(props: {
    groupId?: string
    groupName?: string
    initialAgent?: AgentType
    groupDefaultsUnavailable?: boolean
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string) => void
    onCancel: () => void
    onChooseFolder?: (args: { machineId: string | null; directory: string }) => void
    initialDirectory?: string
    initialMachineId?: string
    continueFromSession?: Session
}) {
    const { haptic } = usePlatform()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
    const { sessions, refetch: refetchSessions } = useSessions(props.api)
    const { getLastUsedMachineId, setLastUsedMachineId } = useLastUsedMachine()

    const continueFrom = props.continueFromSession
    const continueAgent = isKnownFlavor(continueFrom?.metadata?.flavor)
        ? continueFrom.metadata.flavor
        : null
    const [machineId, setMachineId] = useState<string | null>(props.initialMachineId ?? null)
    const [directory, setDirectory] = useState(props.initialDirectory ?? '')
    const [createGroup, setCreateGroup] = useState(false)
    const [groupName, setGroupName] = useState('')
    const groupRequestRef = useRef<{ name: string; requestId: string } | null>(null)
    const [createdGroup, setCreatedGroup] = useState<{ id: string; name: string } | null>(null)

    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const [agent, setAgent] = useState<AgentType>(() => continueAgent ?? props.initialAgent ?? loadPreferredAgent())
    // Snapshot taken once at mount, before any savePreferredAgent() call this
    // component makes can overwrite the stored agent. savePreferredAgent()
    // runs on every agent change (below), so reading loadPreferredAgent()
    // again later would always equal the current agent and make the
    // legacyYoloAgent === agent gate at the restore effect below vacuous.
    const [legacyYoloAgent] = useState(
        () => (loadPreferredYoloMode() ? loadPreferredAgent() : null)
    )
    const [model, setModel] = useState(() => continueFrom?.model ?? 'auto')
    const [cursorSelectedBase, setCursorSelectedBase] = useState('auto')
    const pendingCursorBaseRef = useRef<string | null>(null)
    const [effort, setEffort] = useState<LaunchEffort>(() => continueFrom?.effort ?? 'auto')
    const [modelReasoningEffort, setModelReasoningEffort] = useState<CodexReasoningEffort>(() => continueFrom?.modelReasoningEffort ?? 'default')
    const [opencodeSelectedModel, setOpencodeSelectedModel] = useState<string | null | undefined>(null)
    const [requestedModelCatalog, setRequestedModelCatalog] = useState<string | null>(null)
    const modelCatalogTarget = JSON.stringify([agent, machineId, agent === 'opencode' ? directory.trim() : null])
    const modelCatalogRequested = requestedModelCatalog === modelCatalogTarget
    const [serviceTier, setServiceTier] = useState<NewSessionServiceTier>(() => continueFrom?.serviceTier === 'fast' ? 'fast' : 'standard')
    // Fork: the collaboration-mode selector is dormant; a hidden field must
    // not carry a non-default mode into the spawn, so it stays at 'default'.
    const [collaborationMode, setCollaborationMode] = useState<CodexCollaborationMode>('default')
    const [copilotAgentMode, setCopilotAgentMode] = useState<CopilotAgentMode>(() => continueFrom?.copilotAgentMode ?? 'interactive')
    const [yoloMode, setYoloMode] = useState(loadPreferredYoloMode)
    // Fork: when the hub brands claude as GLM (z.ai), the flavor has no
    // meaningful effort control and the no-pick model is GLM 5.3 Flash.
    const claudeGlmBranded = useClaudeGlmBranding()
    // Fork: YOLO is the launch default for every flavor — native-select
    // flavors start at their own YOLO-equivalent mode (claude/grok map to
    // bypassPermissions, codex family to yolo).
    const [nativePermissionMode, setNativePermissionMode] = useState<PermissionMode>(() => continueFrom?.permissionMode ?? continueFrom?.metadata?.preferredPermissionMode ?? resolveHapiYoloPermissionMode(continueAgent ?? props.initialAgent ?? loadPreferredAgent()) ?? 'default')
    const [grokPermissionMode, setGrokPermissionMode] = useState<GrokPermissionMode>('bypassPermissions')
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [directoryCreationConfirmed, setDirectoryCreationConfirmed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [codexImportSessions, setCodexImportSessions] = useState<CodexLocalSessionSummary[]>([])
    const [selectedCodexImportSessionId, setSelectedCodexImportSessionId] = useState<string | null>(null)
    const [codexImportMachineId, setCodexImportMachineId] = useState<string | null>(null)
    const [isLoadingCodexImportSessions, setIsLoadingCodexImportSessions] = useState(false)
    const [codexImportError, setCodexImportError] = useState<string | null>(null)
    const [isImportingCodexSession, setIsImportingCodexSession] = useState(false)
    const [isCodexImportDialogOpen, setIsCodexImportDialogOpen] = useState(false)
    const [piImportSessions, setPiImportSessions] = useState<PiLocalSessionSummary[]>([])
    const [selectedPiImportSessionId, setSelectedPiImportSessionId] = useState<string | null>(null)
    const [piImportMachineId, setPiImportMachineId] = useState<string | null>(null)
    const [isLoadingPiImportSessions, setIsLoadingPiImportSessions] = useState(false)
    const [piImportError, setPiImportError] = useState<string | null>(null)
    const [isImportingPiSession, setIsImportingPiSession] = useState(false)
    const [isBulkImportingPiSessions, setIsBulkImportingPiSessions] = useState(false)
    const [isPiImportDialogOpen, setIsPiImportDialogOpen] = useState(false)
    const piLoadGenerationRef = useRef(0)
    const [isCreating, setIsCreating] = useState(false)
    const createInFlightRef = useRef(false)
    const [isBulkImportingCodexSessions, setIsBulkImportingCodexSessions] = useState(false)
    const [isRestartingCodexDesktop, setIsRestartingCodexDesktop] = useState(false)
    const [pendingDuplicateSessionIds, setPendingDuplicateSessionIds] = useState<string[]>([])
    const [pendingDuplicateHapiSessionIds, setPendingDuplicateHapiSessionIds] = useState<string[]>([])
    const [duplicateSessionGroups, setDuplicateSessionGroups] = useState<CodexDuplicateSessionGroup[]>([])
    const [isDuplicateMergeConfirmOpen, setIsDuplicateMergeConfirmOpen] = useState(false)
    const [isMergingDuplicateSessions, setIsMergingDuplicateSessions] = useState(false)
    const isFormDisabled = Boolean(
        isCreating
        || isPending
        || props.isLoading
        || isImportingCodexSession
        || isBulkImportingCodexSessions
        || isImportingPiSession
        || isBulkImportingPiSessions
    )
    const worktreeInputRef = useRef<HTMLInputElement>(null)
    const preserveRestoredDraftRef = useRef(Boolean(continueFrom))

    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    useEffect(() => {
        if (preserveRestoredDraftRef.current) {
            return
        }
        setEffort('auto')
        setModelReasoningEffort('default')
        setGrokPermissionMode('default')
        setNativePermissionMode('default')
        setServiceTier('standard')
        setCollaborationMode('default')
        setCopilotAgentMode('interactive')
        if (agent !== 'cursor') {
            setModel('auto')
            setCursorSelectedBase('auto')
        }
    }, [agent])

    useEffect(() => {
        savePreferredAgent(agent)
    }, [agent])

    useEffect(() => {
        if (agent !== 'codex') {
            setSelectedCodexImportSessionId(null)
            setCodexImportSessions([])
            setCodexImportMachineId(null)
            setCodexImportError(null)
        }
    }, [agent])

    useEffect(() => {
        savePreferredYoloMode(yoloMode)
    }, [yoloMode])

    useEffect(() => {
        if (props.initialDirectory !== undefined) {
            setDirectory(props.initialDirectory)
        }
    }, [props.initialDirectory])

    useEffect(() => {
        if (props.initialMachineId !== undefined) {
            setMachineId(props.initialMachineId)
        }
    }, [props.initialMachineId])

    const restoredFromBrowseRef = useRef(false)
    useEffect(() => {
        if (restoredFromBrowseRef.current) {
            return
        }
        if (continueFrom) {
            return
        }
        if (!shouldRestoreNewSessionFormDraft({
            initialDirectory: props.initialDirectory,
            initialMachineId: props.initialMachineId
        })) {
            return
        }
        const draft = loadNewSessionFormDraft()
        if (!draft || draft.groupId !== props.groupId) {
            return
        }
        const targetMachineId = props.initialMachineId ?? machineId
        if (!newSessionDraftMatchesMachine(draft, targetMachineId)) {
            clearNewSessionFormDraft()
            return
        }
        if (!props.groupId && draft.groupCreation) {
            setCreateGroup(true)
            setGroupName(draft.groupCreation.name)
            groupRequestRef.current = draft.groupCreation
        }
        restoredFromBrowseRef.current = true
        preserveRestoredDraftRef.current = true
        setAgent(draft.agent)
        setModel(draft.model)
        setCursorSelectedBase(draft.cursorSelectedBase)
        setEffort(draft.effort)
        // Same policy as the mount restore: codex effort is not restored from
        // a draft, so it cannot override the CLI config behind a hidden value.
        setModelReasoningEffort(draft.agent === 'opencode' ? draft.modelReasoningEffort : 'default')
        setOpencodeSelectedModel(
            draft.agent === 'opencode' && draft.model !== 'auto' ? draft.model : null
        )
        agyModelPickedByUserRef.current = false
        setAgySelectedModel(
            draft.agent === 'agy' && draft.model !== 'auto' ? draft.model : null
        )
        setServiceTier(draft.serviceTier)
        setCollaborationMode('default')
        setCopilotAgentMode(draft.copilotAgentMode)
        setYoloMode(draft.yoloMode)
        setNativePermissionMode(draft.nativePermissionMode)
        setGrokPermissionMode(draft.grokPermissionMode)
        // The worktree selector is not rendered in this fork, so a stale draft
        // must not resurrect a worktree launch behind the hidden control.
        setSessionType('simple')
        setWorktreeName('')
        clearNewSessionFormDraft()
    }, [
        continueFrom,
        props.initialDirectory,
        props.initialMachineId,
        machineId
    ])

    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? props.machines.find((m) => m.id === lastUsed) : null

        if (foundLast) {
            setMachineId(foundLast.id)
            if (!props.initialDirectory) {
                setDirectory(resolveDefaultMachineDirectory(
                    foundLast,
                    getRecentProjectPaths(sessions, foundLast.id)
                ))
            }
        } else if (props.machines[0]) {
            const firstMachine = props.machines[0]
            setMachineId(firstMachine.id)
            if (!props.initialDirectory) {
                setDirectory(resolveDefaultMachineDirectory(
                    firstMachine,
                    getRecentProjectPaths(sessions, firstMachine.id)
                ))
            }
        }
    }, [props.machines, machineId, getLastUsedMachineId, sessions, props.initialDirectory])

    const selectedMachine = useMemo(
        () => (machineId ? props.machines.find((machine) => machine.id === machineId) ?? null : null),
        [machineId, props.machines]
    )
    const agentAvailability = useAgentAvailability({
        api: props.api,
        machineId,
    })
    const cursorDefaultModelName = agentAvailability.agents.find((entry) => entry.agent === 'cursor')?.defaultModelName
    const configuredDefaultModelName = agentAvailability.agents.find((entry) => entry.agent === agent)?.defaultModelName
    const availableAgents = useMemo(
        () => orderCreateSessionAgents(agentAvailability.agents
            .filter((entry) => entry.available && entry.agent !== 'gemini')
            .map((entry) => entry.agent as AgentType)),
        [agentAvailability.agents]
    )
    const selectedAgentAvailable = availableAgents.includes(agent)

    useEffect(() => {
        if (agentAvailability.isLoading || agentAvailability.error || availableAgents.length === 0) return
        if (availableAgents.includes(agent)) return
        preserveRestoredDraftRef.current = false
        setAgent(availableAgents[0]!)
    }, [agent, agentAvailability.error, agentAvailability.isLoading, availableAgents])
    const codexModelsState = useCodexModels({
        api: props.api,
        machineId,
        enabled: agent === 'codex' && Boolean(machineId)
    })
    const [agySelectedModel, setAgySelectedModel] = useState<string | null>(null)
    // Whether the AGY model on screen is one the user picked here, as opposed to
    // one restored from a draft or a saved preference. A restored model that the
    // machine does not advertise is dropped (it may never have been runnable on
    // this machine); one the user just picked is kept, because the catalog can
    // change under an open form while they are looking at it.
    const agyModelPickedByUserRef = useRef(false)
    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(selectedMachine),
        [selectedMachine]
    )
    const codexModelOptions = useMemo(() => {
        // With no model picked, codex runs whatever its own config default is,
        // and the catalog marks that model — so the "no pick" option is named
        // after it instead of a blind "Default". Until the catalog lands,
        // the plain word stays. The catalog row for the default model itself
        // is skipped (picking the option already launches it) unless the user
        // explicitly pinned that id.
        const defaultModel = resolveCodexModel(codexModelsState.models, 'auto')
        const options = [{ value: 'auto', label: defaultModel?.displayName ?? 'Default' }]
        for (const codexModel of codexModelsState.models) {
            if (codexModel.id === defaultModel?.id && model !== codexModel.id) {
                continue
            }
            options.push({
                value: codexModel.id,
                label: codexModel.displayName
            })
        }
        if (model !== 'auto' && !options.some((option) => option.value === model)) {
            options.splice(1, 0, { value: model, label: model })
        }
        return options
    }, [codexModelsState.models, model])
    const codexSupportedReasoningEfforts = useMemo(
        () => getCodexModelReasoningEfforts(codexModelsState.models, model),
        [codexModelsState.models, model]
    )
    useEffect(() => {
        if (
            agent !== 'codex'
            || modelReasoningEffort === 'default'
            || !codexSupportedReasoningEfforts
            || codexSupportedReasoningEfforts.includes(modelReasoningEffort)
        ) {
            return
        }
        setModelReasoningEffort('default')
    }, [agent, codexSupportedReasoningEfforts, modelReasoningEffort])


    useEffect(() => {
        if (
            agent !== 'codex'
            || model === 'auto'
            || codexModelsState.isLoading
            || codexModelsState.error
        ) {
            return
        }
        if (!codexModelsState.models.some((candidate) => candidate.id === model)
            && !CODEX_HARDCODED_OPTIONS.some((option) => option.value === model)) {
            setModel('auto')
        }
    }, [agent, codexModelsState.error, codexModelsState.isLoading, codexModelsState.models, model])
    const showCodexFastMode = agent === 'codex'
        && !codexModelsState.error
        && codexModelAdvertisesFastTier(model === 'auto' ? null : model, codexModelsState.models)

    useEffect(() => {
        // Wait for the Codex model catalog to settle before clearing Fast;
        // otherwise Browse → remount restores serviceTier: 'fast' and this
        // effect would wipe it while models are still loading.
        if (agent === 'codex' && codexModelsState.isLoading) {
            return
        }
        if (!showCodexFastMode && serviceTier !== 'standard') {
            setServiceTier('standard')
        }
    }, [agent, codexModelsState.isLoading, showCodexFastMode, serviceTier])
    // Fork hardcoded models: these flavors always run one model, so the form
    // pins it instead of offering the catalog dropdown. Literals only.
    // The Other badge opens the full catalog selector as an escape hatch.
    const [showAllModels, setShowAllModels] = useState(false)
    useEffect(() => {
        setShowAllModels(false)
    }, [agent, machineId])
    useEffect(() => {
        if (agent !== 'codex' || showAllModels) {
            return
        }
        if (model !== 'auto' && CODEX_HARDCODED_OPTIONS.some((option) => option.value === model)) {
            return
        }
        setModel(CODEX_DEFAULT_MODEL_ID)
    }, [agent, model, showAllModels])
    useEffect(() => {
        if (agent === 'claude' && claudeGlmBranded && model !== 'auto' && model !== CLAUDE_GLM_MODEL_ID) {
            setModel('auto')
        }
    }, [agent, claudeGlmBranded, model])
    useEffect(() => {
        if (agent === 'agy' && !showAllModels && agySelectedModel !== null && agySelectedModel !== AGY_HIGH_MODEL_ID) {
            agyModelPickedByUserRef.current = false
            setAgySelectedModel(null)
        }
    }, [agent, agySelectedModel, showAllModels])
    const cursorModelsState = useCursorModelsForMachine({
        api: props.api,
        machineId,
        enabled: agent === 'cursor' && Boolean(machineId)
            && (modelCatalogRequested
                || (model !== 'auto' && model !== 'default[]')
                || (cursorSelectedBase !== 'auto' && cursorSelectedBase !== 'default[]'))
    })
    const cursorPicker = useMemo(
        () => buildNewSessionCursorPickerState(
            cursorModelsState.availableModels,
            model,
            cursorModelsState.cliModelSkus
        ),
        [cursorModelsState.availableModels, cursorModelsState.cliModelSkus, model]
    )
    const availableCursorCatalog = useMemo(
        () => buildNewSessionCursorModelCatalog(
            cursorModelsState.availableModels,
            'auto',
            cursorModelsState.cliModelSkus
        ),
        [cursorModelsState.availableModels, cursorModelsState.cliModelSkus]
    )
    // Cursor models are hardcoded literals, no catalog lookup.
    const hardcodedCursorOptions = useMemo(
        () => [
            { value: CURSOR_GROK_XHIGH_WIRE, label: 'Grok 4.7 Extra High' },
            { value: CURSOR_COMPOSER_STANDARD_WIRE, label: 'Composer 2.5' },
        ],
        []
    )
    // Escape hatch behind the hardcoded badges: reveals the full catalog picker.
    const [showAllCursorModels, setShowAllCursorModels] = useState(false)
    useEffect(() => {
        setShowAllCursorModels(false)
    }, [agent, machineId])
    useEffect(() => {
        // Idempotent and coercive in badges mode: anything outside the
        // hardcoded shortlist (including auto) snaps to Grok Extra High.
        // Fast stays off until the user picks it. With the hatch open the
        // user owns the selection.
        if (agent !== 'cursor' || showAllCursorModels) return
        if (isHardcodedCursorModelId(model)) return
        setModel(CURSOR_GROK_XHIGH_WIRE)
        setCursorSelectedBase('grok-4.7')
    }, [agent, model, showAllCursorModels])
    const cursorSpeedOptions = agent === 'cursor' ? getCursorModelSpeedOptions(model) : null
    const cursorServiceTier = cursorSpeedOptions?.fast === model ? 'fast' : 'standard'

    useEffect(() => {
        if (
            agent !== 'cursor'
            || cursorModelsState.isLoading
            || cursorModelsState.error
        ) {
            return
        }
        if (model !== 'auto' && model !== 'default[]' && !isHardcodedCursorModelId(model) && !availableCursorCatalog.wireToBase.has(model)) {
            setModel('auto')
            setCursorSelectedBase('auto')
            return
        }
        if (
            cursorSelectedBase !== 'auto'
            && cursorSelectedBase !== 'default[]'
            && !isHardcodedCursorModelId(model)
            && !availableCursorCatalog.variantsByBase.has(cursorSelectedBase)
        ) {
            setCursorSelectedBase('auto')
        }
    }, [
        agent,
        availableCursorCatalog,
        cursorModelsState.error,
        cursorModelsState.isLoading,
        cursorSelectedBase,
        model
    ])

    const cursorBaseSelectValue = useMemo(
        () => resolveNewSessionCursorBaseSelectValue(cursorPicker, cursorSelectedBase),
        [cursorPicker, cursorSelectedBase]
    )

    const cursorVariantOptions = useMemo(() => {
        if (cursorPicker.mode !== 'dual') {
            return cursorPicker.effortOptions
        }
        const baseKey = cursorBaseSelectValue !== 'auto' && cursorBaseSelectValue !== 'default[]'
            ? cursorBaseSelectValue
            : cursorPicker.baseKey
        return buildCursorEffortPickerOptions(resolveCursorVariantOptions(baseKey ?? null, cursorPicker.catalog))
    }, [cursorPicker, cursorBaseSelectValue])

    const cursorVariantSelectOptions = useMemo(() => {
        if (cursorVariantOptions.length === 0) {
            return []
        }
        return [
            { value: 'auto', label: t('newSession.model.selectVariant') },
            ...cursorVariantOptions
        ]
    }, [cursorVariantOptions, t])

    const cursorEffortSelectValue = useMemo(
        () => resolveNewSessionCursorEffortSelectValue(model, cursorVariantOptions),
        [model, cursorVariantOptions]
    )

    useEffect(() => {
        if (agent !== 'cursor' || cursorModelsState.isLoading) {
            return
        }
        if (model === 'auto' && cursorSelectedBase !== 'auto') {
            return
        }
        if (model === 'auto' || model === 'default[]') {
            return
        }
        const base = resolveCursorBaseFromWire(model, cursorPicker.catalog)
        if (cursorSelectedBase === base) {
            return
        }
        setCursorSelectedBase(base)
    }, [
        agent,
        model,
        cursorModelsState.isLoading,
        cursorPicker.catalog,
        cursorSelectedBase
    ])

    const showCursorVariantPicker = showAllCursorModels && model !== 'auto' && model !== 'default[]' && cursorPicker.mode === 'dual' && cursorVariantOptions.length > 1

    useEffect(() => {
        if (agent !== 'cursor' || cursorModelsState.isLoading) {
            return
        }
        const pendingBase = pendingCursorBaseRef.current
        if (!pendingBase) {
            return
        }
        if (cursorPicker.catalog.variantsByBase.size === 0) {
            return
        }
        pendingCursorBaseRef.current = null
        if (pendingBase === 'auto') {
            setModel('auto')
            return
        }
        setModel(resolveWireIdForBaseChange(pendingBase, cursorPicker.catalog, model) ?? 'auto')
    }, [
        agent,
        cursorModelsState.isLoading,
        cursorPicker.catalog,
        model
    ])
    const cursorModelPickersDisabled = isFormDisabled || !machineId
    const cursorModelsUnavailable = modelCatalogRequested && shouldShowCursorModelsUnavailable({
        agent,
        isLoading: cursorModelsState.isLoading,
        error: cursorModelsState.error,
        availableModels: cursorModelsState.availableModels
    })

    const recentPaths = useMemo(
        () => getRecentProjectPaths(sessions, machineId),
        [sessions, machineId]
    )

    const hubContextSync = useSessionContextHubSync()
    const { workAliases, projectOverrides } = useSessionContextFilter(hubContextSync)
    const { workPaths, recentPaths: filteredRecentPaths } = useProjectPaths(
        sessions,
        machineId,
        { workAliases, projectOverrides }
    )

    const trimmedDirectory = directory.trim()
    const deferredDirectory = useDeferredValue(trimmedDirectory)
    const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)
    const workspaceRoots = useMemo(
        () => selectedMachine?.metadata?.workspaceRoots ?? [],
        [selectedMachine?.metadata?.workspaceRoots]
    )
    const directoryListingCacheRef = useRef(
        new Map<string, Awaited<ReturnType<ApiClient['listMachineDirectory']>>>()
    )

    useEffect(() => {
        directoryListingCacheRef.current.clear()
    }, [machineId])

    const pathsToCheck = useMemo(
        () => Array.from(new Set([
            ...(deferredDirectory ? [deferredDirectory] : []),
            ...allPaths
        ])).slice(0, 1000),
        [allPaths, deferredDirectory]
    )

    const { pathExistence, outsideWorkspaceRoots, checkPathsExists } = useMachinePathsExists(
        props.api,
        machineId,
        pathsToCheck
    )

    const verifiedPaths = useMemo(
        () => allPaths.filter((path) => pathExistence[path]),
        [allPaths, pathExistence]
    )

    const deferredDirectoryExists = deferredDirectory
        ? pathExistence[deferredDirectory]
        : undefined
    const opencodeModelsState = useOpencodeModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        // Gate on positive existence: typing partial paths must not spawn an
        // expensive `opencode acp` probe for a non-existent cwd while the
        // existence check is in flight.
        enabled: (modelCatalogRequested || Boolean(opencodeSelectedModel) || modelReasoningEffort !== 'default')
            && shouldEnableOpencodeModelDiscovery({
                agent,
                machineId,
                cwd: deferredDirectory,
                cwdExists: deferredDirectoryExists,
            })
    })
    const opencodeVariantsState = useOpencodeModelVariants({
        api: props.api,
        machineId,
        cwd: deferredDirectory || null,
        enabled: (Boolean(opencodeSelectedModel) || modelReasoningEffort !== 'default')
            && !opencodeModelsState.isLoading
            && opencodeModelsState.availableModels.length > 0
            && shouldEnableOpencodeModelDiscovery({
                agent,
                machineId,
                cwd: deferredDirectory,
                cwdExists: deferredDirectoryExists,
            })
    })
    // OpenCode model option values are provider-qualified (`provider/model`),
    // matching the variant catalog keys from the OpenCode server `/provider`
    // endpoint. undefined = not applicable / no selection; null = loading or
    // failed (static fallback); [] = catalog loaded and the selected model
    // has no variants (hide the field — matches mid-session behavior).
    const opencodeVariantOptions = useMemo(() => {
        if (agent !== 'opencode' || !machineId) {
            return undefined
        }
        const effectiveModelId = !opencodeSelectedModel || opencodeSelectedModel === 'auto'
            ? opencodeModelsState.currentModelId
            : opencodeSelectedModel
        if (!effectiveModelId) {
            return null
        }
        if (opencodeVariantsState.isLoading || opencodeVariantsState.error || !opencodeVariantsState.variants) {
            return null
        }
        return opencodeVariantsState.variants[effectiveModelId] ?? []
        // Primitive/state-slice deps: the hook returns a fresh object per render,
        // and a per-render options array would retrigger the reset effect below.
    }, [agent, machineId, opencodeSelectedModel, opencodeModelsState.currentModelId, opencodeVariantsState.variants, opencodeVariantsState.isLoading, opencodeVariantsState.error])
    const opencodeCatalogPending = agent === 'opencode'
        && (modelCatalogRequested || Boolean(opencodeSelectedModel) || modelReasoningEffort !== 'default')
        && deferredDirectory !== ''
        && (
            deferredDirectoryExists === undefined
            || (deferredDirectoryExists === true
                && (opencodeModelsState.isLoading || opencodeVariantsState.isLoading))
        )

    useEffect(() => {
        if (
            agent !== 'opencode'
            || modelReasoningEffort === 'default'
            || opencodeCatalogPending
        ) {
            return
        }
        const dynamicVariants = opencodeVariantOptions ?? null
        if (!isOpencodeReasoningEffortValid(modelReasoningEffort, dynamicVariants)) {
            setModelReasoningEffort('default')
        }
    }, [agent, modelReasoningEffort, opencodeVariantOptions, opencodeCatalogPending])
    const grokModelsState = useGrokModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        enabled: shouldEnableGrokModelDiscovery({
            agent,
            machineId,
            cwd: deferredDirectory,
            cwdExists: deferredDirectoryExists,
        })
    })
    const copilotModelsState = useCopilotModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        enabled: agent === 'copilot' && deferredDirectoryExists === true
    })
    const kimiModelsState = useKimiModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        enabled: shouldEnableKimiModelDiscovery({
            agent,
            machineId,
            cwd: deferredDirectory,
            cwdExists: deferredDirectoryExists,
        })
    })
    const kimiModelOptions = useMemo(
        () => buildKimiModelOptions(kimiModelsState.availableModels),
        [kimiModelsState.availableModels]
    )
    const copilotModelOptions = useMemo(
        () => [
            { value: 'auto', label: 'Auto' },
            ...copilotModelsState.availableModels
                .filter((candidate) => candidate.modelId !== 'auto')
                .map((candidate) => ({
                    value: candidate.modelId,
                    label: candidate.name ?? candidate.modelId
                }))
        ],
        [copilotModelsState.availableModels]
    )
    const grokModelOptions = useMemo(
        () => buildGrokModelOptions(grokModelsState.availableModels),
        [grokModelsState.availableModels]
    )
    const grokEffortOptions = useMemo(
        () => buildGrokEffortOptions(
            grokModelsState.availableModels,
            model,
            grokModelsState.currentModelId
        ),
        [grokModelsState.availableModels, grokModelsState.currentModelId, model]
    )
    useEffect(() => {
        if (
            agent === 'grok'
            && grokPermissionMode === 'auto'
            && grokModelsState.autoPermissionModeSupported === false
        ) {
            setGrokPermissionMode('default')
        }
    }, [agent, grokPermissionMode, grokModelsState.autoPermissionModeSupported])
    const agyModelsState = useAgyModels({
        api: props.api,
        machineId,
        enabled: agent === 'agy' && Boolean(machineId)
    })
    const piModelsState = usePiModelsForMachine({
        api: props.api,
        machineId,
        enabled: agent === 'pi' && Boolean(machineId)
    })
    // Pi models are grouped by provider (optionSource: 'machine' in the agent
    // config descriptor). Option values are provider-qualified
    // (`provider/modelId`) so two providers sharing a modelId stay distinct;
    // the CLI startup match resolves the qualified id before applying set_model.
    const piModelOptions = useMemo(() => {
        const groups = groupModelsByProvider(piModelsState.availableModels)
        return [
            { value: 'auto', label: 'Default' },
            ...groups.flatMap((group) => group.models.map((model) => ({
                value: `${model.provider || 'unknown'}/${model.modelId}`,
                label: model.name ?? model.modelId,
                group: group.label,
            }))),
        ]
    }, [piModelsState.availableModels])
    const piSelectedModel = useMemo(() => {
        if (agent !== 'pi' || model === 'auto') return null
        const slash = model.indexOf('/')
        if (slash > 0) {
            const provider = model.slice(0, slash)
            const modelId = model.slice(slash + 1)
            return piModelsState.availableModels.find(
                (candidate) => candidate.provider === provider && candidate.modelId === modelId
            ) ?? null
        }
        return piModelsState.availableModels.find((candidate) => candidate.modelId === model) ?? null
    }, [agent, model, piModelsState.availableModels])
    useEffect(() => {
        // A non-reasoning Pi model must not carry a stale launch effort (the
        // CLI would reject it and fall back to Pi's default), and a level the
        // selected model's thinkingLevelMap marks unsupported must not survive
        // a model switch (mirrors the HappyComposer effort reconciliation).
        if (agent !== 'pi' || effort === 'auto') {
            return
        }
        if (piSelectedModel?.reasoning === false) {
            setEffort('auto')
            return
        }
        // Reset a level the current selection cannot offer, so a level the
        // field no longer renders can never be submitted. This covers:
        //   - a resolved model whose map excludes the level;
        //   - the Default selection (model === 'auto', no map, hides xhigh/max);
        //   - a failed catalog request, where a restored explicit model stays
        //     unresolved for good and creation is not blocked (only loading
        //     gates it), so waiting for a map that will never arrive would let
        //     the hidden level through.
        // While a concrete model is still resolving (no error yet) do not
        // reset — the map may still prove a restored xhigh/max valid.
        const piSelectionSettled = model === 'auto'
            || Boolean(piSelectedModel)
            || Boolean(piModelsState.error)
        if (
            piSelectionSettled
            && !isThinkingLevelSupported(effort, piSelectedModel?.thinkingLevelMap)
        ) {
            setEffort('auto')
        }
    }, [agent, model, piSelectedModel, piModelsState.error, effort])
    useEffect(() => {
        // Reconcile a restored Pi selection with the live machine catalog
        // (mirrors the Codex/Grok/Copilot validation effects). A model that
        // left the catalog must not stay in state: the native select would
        // visually fall back to Default while Create still sends the stale id.
        if (
            agent !== 'pi'
            || piModelsState.isLoading
            || piModelsState.error
            || model === 'auto'
        ) {
            return
        }
        if (!piModelOptions.some((option) => option.value === model)) {
            setModel('auto')
            setEffort('auto')
        }
    }, [agent, model, piModelOptions, piModelsState.error, piModelsState.isLoading])
    useEffect(() => {
        if (preserveRestoredDraftRef.current) {
            return
        }
        // Reset selection when agent / machine changes. The default is "Default"
        // (null → no --model → agy uses its own default); we intentionally do NOT
        // auto-pick the first model, so the user's explicit "Default" choice
        // sticks instead of snapping to the first option.
        agyModelPickedByUserRef.current = false
        setAgySelectedModel(null)
    }, [agent, machineId])

    useEffect(() => {
        if (agent === 'agy' && isRemovedAgyModel(agySelectedModel)) {
            setAgySelectedModel(null)
            return
        }
        if (
            agent !== 'agy'
            || agyModelsState.isLoading
            || agyModelsState.error
            || agySelectedModel === null
            || agySelectedModel === AGY_HIGH_MODEL_ID
            || agyModelPickedByUserRef.current
        ) {
            return
        }
        if (!agyModelsState.availableModels.some((candidate) => candidate.modelId === agySelectedModel)) {
            setAgySelectedModel(null)
        }
    }, [
        agent,
        agyModelsState.availableModels,
        agyModelsState.error,
        agyModelsState.isLoading,
        agySelectedModel
    ])

    useEffect(() => {
        // Restore a remembered model when it is still advertised for this cwd;
        // otherwise auto-pick the backend default.
        if (
            agent !== 'opencode'
            || deferredDirectoryExists !== true
            || !opencodeModelsState.availableModels.length
            || opencodeModelsState.isLoading
            || opencodeModelsState.error
        ) {
            return
        }
        // Preserve explicit choices, including Default (null) and quick picks
        // missing from a stale catalog. Only undefined needs initialization.
        if (opencodeSelectedModel !== undefined) {
            return
        }
        const rememberedModel = machineId
            ? loadPreferredLaunchSettings(machineId, 'opencode')?.model
            : null
        const rememberedModelAvailable = rememberedModel
            && rememberedModel !== 'auto'
            && opencodeModelsState.availableModels.some(
                (candidate) => candidate.modelId === rememberedModel
            )
        const fallback = (rememberedModelAvailable ? rememberedModel : null)
            ?? opencodeModelsState.currentModelId
            ?? opencodeModelsState.availableModels[0]?.modelId
            ?? null
        setOpencodeSelectedModel(fallback)
    }, [
        agent,
        deferredDirectoryExists,
        opencodeModelsState.availableModels,
        opencodeModelsState.currentModelId,
        opencodeModelsState.error,
        opencodeModelsState.isLoading,
        opencodeSelectedModel,
        machineId
    ])
    useEffect(() => {
        // A different launch target starts at its own configured default.
        if (preserveRestoredDraftRef.current) {
            return
        }
        setOpencodeSelectedModel(null)
    }, [agent, machineId, deferredDirectory])

    const usesNativeSelect = usesNativePermissionSelect(agent)
    const usesSharedPermissionMode = usesSharedPermissionModeState(agent)

    useEffect(() => {
        if (!machineId || preserveRestoredDraftRef.current) {
            return
        }

        const preferred = resolvePreferredLaunchSettings(
            agent,
            loadPreferredLaunchSettings(machineId, agent),
            legacyYoloAgent === agent
        )

        // The model choice is deliberately not remembered: every fresh form
        // starts at the agent's own default (its CLI config decides), and a
        // concrete model is picked per launch. The per-machine preference only
        // carries effort/permission touches. Cursor badges own their model via
        // the pin effect above, so they are exempt here.
        if (agent !== 'cursor') {
            setModel('auto')
            setCursorSelectedBase('auto')
        }
        // A GLM-branded claude hides the effort field; the remembered value
        // must not silently survive where the user cannot see or change it.
        setEffort(agent === 'claude' && getClaudeGlmBranded() ? 'auto' : preferred.effort)
        // Codex effort is not remembered either: it starts at Default, which
        // defers to codex's own config (this fork pins high there), so a
        // stale remembered value cannot keep overriding the config.
        setModelReasoningEffort(agent === 'opencode' ? preferred.modelReasoningEffort : 'default')
        if (usesSharedPermissionMode) {
            // Fork: YOLO is the launch default for every flavor. A remembered
            // mode no longer pins the form (a stored 'default' kept claude
            // milder than intended) — pick a milder mode per launch instead.
            setNativePermissionMode(resolveHapiYoloPermissionMode(agent) ?? 'default')
        }
        setOpencodeSelectedModel(null)
        agyModelPickedByUserRef.current = false
        setAgySelectedModel(null)
    }, [agent, legacyYoloAgent, machineId, usesSharedPermissionMode])

    useEffect(() => {
        if (
            agent !== 'grok'
            || deferredDirectoryExists !== true
            || grokModelsState.isLoading
            || grokModelsState.error
        ) {
            return
        }
        if (
            model !== 'auto'
            && !grokModelsState.availableModels.some((candidate) => candidate.modelId === model)
        ) {
            setModel('auto')
        }
        if (
            effort !== 'auto'
            && !grokEffortOptions.some((option) => option.value === effort)
        ) {
            setEffort('auto')
        }
    }, [
        agent,
        deferredDirectoryExists,
        effort,
        grokEffortOptions,
        grokModelsState.availableModels,
        grokModelsState.error,
        grokModelsState.isLoading,
        model
    ])
    useEffect(() => {
        if (
            agent === 'copilot'
            && deferredDirectoryExists === true
            && !copilotModelsState.isLoading
            && !copilotModelsState.error
            && model !== 'auto'
            && !copilotModelsState.availableModels.some((candidate) => candidate.modelId === model)
        ) {
            setModel('auto')
        }
    }, [
        agent,
        copilotModelsState.availableModels,
        copilotModelsState.error,
        copilotModelsState.isLoading,
        deferredDirectoryExists,
        model
    ])
    useEffect(() => {
        if (
            agent === 'kimi'
            && deferredDirectoryExists === true
            && !kimiModelsState.isLoading
            && !kimiModelsState.error
            && model !== 'auto'
            && !kimiModelsState.availableModels.some((candidate) => candidate.modelId === model)
        ) {
            setModel('auto')
        }
    }, [
        agent,
        kimiModelsState.availableModels,
        kimiModelsState.error,
        kimiModelsState.isLoading,
        deferredDirectoryExists,
        model
    ])

    const currentDirectoryExists = trimmedDirectory ? pathExistence[trimmedDirectory] : undefined
    const directoryOutsideWorkspaceRoots = trimmedDirectory
        ? outsideWorkspaceRoots.has(trimmedDirectory)
        : false
    const needsDirectoryCreationWarning = !directoryOutsideWorkspaceRoots
        && sessionType === 'simple'
        && trimmedDirectory !== ''
        && currentDirectoryExists === false
    const missingWorktreeDirectory = !directoryOutsideWorkspaceRoots
        && sessionType === 'worktree'
        && trimmedDirectory !== ''
        && currentDirectoryExists === false
    const directoryStatusMessage = directoryOutsideWorkspaceRoots
        ? t('newSession.directoryOutsideWorkspaceRoots')
        : missingWorktreeDirectory
        ? t('session.directoryMissingWorktree')
        : needsDirectoryCreationWarning
            ? (
                directoryCreationConfirmed
                    ? t('session.directoryMissingSimpleConfirm')
                    : t('session.directoryMissingSimple')
            )
            : null
    const directoryStatusTone = directoryOutsideWorkspaceRoots || missingWorktreeDirectory
        ? 'error'
        : needsDirectoryCreationWarning
            ? 'warning'
            : null
    const createLabel = needsDirectoryCreationWarning && directoryCreationConfirmed
        ? t('session.createAndCreateDirectory')
        : undefined

    useEffect(() => {
        setDirectoryCreationConfirmed(false)
    }, [machineId, sessionType, trimmedDirectory])

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        const knownPaths = verifiedPaths
            .filter((path) => path.toLowerCase().includes(lowered))
        const searchTarget = resolveDirectorySearchTarget(query, workspaceRoots)
        let filesystemPaths: string[] = []

        if (machineId && searchTarget) {
            const cacheKey = `${machineId}\u0000${searchTarget.directory}`
            let listing = directoryListingCacheRef.current.get(cacheKey)
            if (!listing) {
                try {
                    listing = await props.api.listMachineDirectory(machineId, searchTarget.directory)
                    if (listing.success) {
                        directoryListingCacheRef.current.set(cacheKey, listing)
                    }
                } catch {
                    listing = undefined
                }
            }
            if (listing?.success && listing.entries) {
                filesystemPaths = getMatchingDirectoryPaths(searchTarget, listing.entries)
            }
        }

        return [...new Set([...filesystemPaths, ...knownPaths])]
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [machineId, props.api, verifiedPaths, workspaceRoots])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory

    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )



    const handleArchiveCodexImportSession = useCallback(async (session: CodexLocalSessionSummary) => {
        if (!props.api) return
        const result = await props.api.archiveCodexSession(session.id, codexImportMachineId ?? machineId)
        if (!result.success) {
            throw new Error(result.error)
        }
        setCodexImportSessions((current) => current.filter((item) => item.id !== session.id))
        if (selectedCodexImportSessionId === session.id) {
            setSelectedCodexImportSessionId(null)
        }
    }, [codexImportMachineId, machineId, props.api, selectedCodexImportSessionId])

    const loadCodexImportSessions = useCallback(async () => {
        if (agent !== 'codex' || !machineId) return
        setIsLoadingCodexImportSessions(true)
        setCodexImportError(null)
        try {
            const result = await props.api.getCodexSessions(trimmedDirectory || null, machineId)
            setCodexImportSessions(result.sessions)
            setCodexImportMachineId(result.machineId ?? machineId)
            setSelectedCodexImportSessionId((current) => current && result.sessions.some((session) => session.id === current) ? current : null)
        } catch (e) {
            setCodexImportSessions([])
            setCodexImportMachineId(null)
            setSelectedCodexImportSessionId(null)
            setCodexImportError(e instanceof Error ? e.message : t('codexSync.failed.body'))
        } finally {
            setIsLoadingCodexImportSessions(false)
        }
    }, [agent, machineId, props.api, trimmedDirectory, t])

    useEffect(() => {
        piLoadGenerationRef.current += 1
        setIsLoadingPiImportSessions(false)
    }, [agent, machineId, trimmedDirectory])

    useEffect(() => () => {
        piLoadGenerationRef.current += 1
    }, [])

    const loadPiImportSessions = useCallback(async () => {
        if (agent !== 'pi' || !machineId) return
        const generation = ++piLoadGenerationRef.current
        setIsLoadingPiImportSessions(true)
        setPiImportError(null)
        try {
            const result = await props.api.getPiSessions(trimmedDirectory || null, machineId)
            if (generation !== piLoadGenerationRef.current) return
            if (!result.success) throw new Error(result.error)
            setPiImportSessions(result.sessions)
            setPiImportMachineId(result.machineId ?? machineId)
            setSelectedPiImportSessionId((current) => current && result.sessions.some((session) => session.id === current) ? current : null)
        } catch (loadError) {
            if (generation !== piLoadGenerationRef.current) return
            setPiImportSessions([])
            setPiImportMachineId(null)
            setSelectedPiImportSessionId(null)
            setPiImportError(loadError instanceof Error ? loadError.message : t('piImport.failed.body'))
        } finally {
            if (generation === piLoadGenerationRef.current) setIsLoadingPiImportSessions(false)
        }
    }, [agent, machineId, props.api, trimmedDirectory, t])

    const formatPiImportError = useCallback((code?: string, message?: string): string => {
        if (code === 'transcript_diverged') return t('piImport.error.diverged')
        if (code === 'session_active') return t('piImport.error.active')
        return message?.trim() || t('piImport.failed.body')
    }, [t])

    const normalizeCodexScriptError = useCallback((message: string | null | undefined, fallback: string): string => {
        const raw = (message ?? '').trim()
        if (!raw) return fallback
        if (/执行超时|timed\s*out|timeout/i.test(raw)) return t('codexSync.error.timeout')
        if (/当前会话仍处于活跃状态，请等待会话结束后重试|Active Hapi process already has this Codex thread/i.test(raw)) {
            return t('codexSync.error.active')
        }
        if (/未安装\/找不到codex客户端|unable to find codex launcher|找不到.*codex/i.test(raw)) {
            return t('codexSync.restart.failed.notFound')
        }
        return raw
    }, [t])

    const formatCodexImportFailure = useCallback((reason: string): string => {
        if (
            reason === t('codexSync.error.timeout')
            || reason === t('codexSync.error.active')
            || reason === t('codexSync.restart.failed.notFound')
        ) {
            return reason
        }
        return t('codexSync.failed.bodyWithReason', { reason })
    }, [t])

    const handleRestartCodexDesktop = useCallback(async () => {
        setIsRestartingCodexDesktop(true)
        try {
            const status = await props.api.getCodexDesktopStatus()
            if (!status.codexClientAvailable) throw new Error(t('codexSync.restart.failed.notFound'))

            const result = await props.api.restartCodexDesktop()
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.restart.failed.body')))
            }
            addToast({
                title: t('codexSync.restart.started.title'),
                body: t('codexSync.restart.started.body'),
                sessionId: '',
                url: ''
            })
        } catch (restartError) {
            addToast({
                title: t('codexSync.restart.failed.title'),
                body: normalizeCodexScriptError(
                    restartError instanceof Error ? restartError.message : null,
                    t('codexSync.restart.failed.body')
                ),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsRestartingCodexDesktop(false)
        }
    }, [addToast, normalizeCodexScriptError, props.api, t])

    const closeDuplicateMergeDialog = useCallback(() => {
        setIsDuplicateMergeConfirmOpen(false)
        setPendingDuplicateSessionIds([])
        setPendingDuplicateHapiSessionIds([])
        setDuplicateSessionGroups([])
    }, [])

    const handleBulkImportCodexSessions = useCallback(async (sessionIds: string[]) => {
        if (isBulkImportingCodexSessions || isLoadingCodexImportSessions) return

        setIsBulkImportingCodexSessions(true)
        try {
            const result = await props.api.syncCodexSession({
                sessionIds,
                cwd: trimmedDirectory || null,
                machineId: codexImportMachineId ?? machineId
            })
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.failed.body')))
            }

            markCodexSessionsImported(sessionIds)
            setSelectedCodexImportSessionId((current) =>
                clearBatchImportedCodexSelection(current, sessionIds)
            )
            setIsCodexImportDialogOpen(false)
            addToast({
                title: t('codexSync.success.title'),
                body: t('codexSync.success.body', { n: result.syncedCount ?? sessionIds.length }),
                sessionId: '',
                url: ''
            })
            await refetchSessions()

            closeDuplicateMergeDialog()
            setPendingDuplicateHapiSessionIds(result.hapiSessionIds ?? [])
            try {
                const duplicateResult = await props.api.getCodexDuplicateSessions({ sessionIds })
                if (!duplicateResult.success) {
                    throw new Error(normalizeCodexScriptError(
                        duplicateResult.error,
                        t('codexSync.duplicates.detect.failed.body')
                    ))
                }
                if (duplicateResult.duplicates.length > 0) {
                    setPendingDuplicateSessionIds(sessionIds)
                    setPendingDuplicateHapiSessionIds(result.hapiSessionIds ?? [])
                    setDuplicateSessionGroups(duplicateResult.duplicates)
                    setIsDuplicateMergeConfirmOpen(true)
                }
            } catch (duplicateError) {
                addToast({
                    title: t('codexSync.duplicates.detect.failed.title'),
                    body: normalizeCodexScriptError(
                        duplicateError instanceof Error ? duplicateError.message : null,
                        t('codexSync.duplicates.detect.failed.body')
                    ),
                    sessionId: '',
                    url: ''
                })
            }
        } catch (importError) {
            const reason = normalizeCodexScriptError(
                importError instanceof Error ? importError.message : null,
                t('dialog.error.default')
            )
            addToast({
                title: t('codexSync.failed.title'),
                body: formatCodexImportFailure(reason),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsBulkImportingCodexSessions(false)
        }
    }, [
        addToast,
        closeDuplicateMergeDialog,
        codexImportMachineId,
        formatCodexImportFailure,
        isBulkImportingCodexSessions,
        isLoadingCodexImportSessions,
        machineId,
        normalizeCodexScriptError,
        props.api,
        refetchSessions,
        t,
        trimmedDirectory
    ])

    const handleMergeDuplicateSessions = useCallback(async () => {
        if (isMergingDuplicateSessions || pendingDuplicateSessionIds.length === 0) return

        setIsMergingDuplicateSessions(true)
        try {
            const result = await props.api.mergeCodexDuplicateSessions({ sessionIds: pendingDuplicateSessionIds })
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.duplicates.merge.failed.body')))
            }
            addToast({
                title: t('codexSync.duplicates.merge.success.title'),
                body: t('codexSync.duplicates.merge.success.body'),
                sessionId: '',
                url: ''
            })
            const redirectSessionId = resolveCodexImportRedirectSessionId(
                result.merged,
                pendingDuplicateHapiSessionIds
            )
            closeDuplicateMergeDialog()
            await refetchSessions()
            if (redirectSessionId) props.onSuccess(redirectSessionId)
        } catch (mergeError) {
            addToast({
                title: t('codexSync.duplicates.merge.failed.title'),
                body: normalizeCodexScriptError(
                    mergeError instanceof Error ? mergeError.message : null,
                    t('codexSync.duplicates.merge.failed.body')
                ),
                sessionId: '',
                url: ''
            })
            throw mergeError
        } finally {
            setIsMergingDuplicateSessions(false)
        }
    }, [
        addToast,
        closeDuplicateMergeDialog,
        isMergingDuplicateSessions,
        normalizeCodexScriptError,
        pendingDuplicateHapiSessionIds,
        pendingDuplicateSessionIds,
        props.api,
        props.onSuccess,
        refetchSessions,
        t
    ])

    const handleBulkImportPiSessions = useCallback(async (sessionIds: string[]) => {
        if (isBulkImportingPiSessions || isLoadingPiImportSessions) return
        setIsBulkImportingPiSessions(true)
        try {
            const result = await props.api.importPiSessions({
                sessionIds,
                cwd: trimmedDirectory || null,
                machineId: piImportMachineId ?? machineId
            })
            const importedCount = result.results.filter((item) => item.hapiSessionId && !item.error).length
            const failed = result.results.filter((item) => item.error)
            if (importedCount > 0) {
                addToast({
                    title: t('piImport.success.title'),
                    body: t('piImport.success.body', { n: importedCount }),
                    sessionId: '',
                    url: ''
                })
                await refetchSessions()
                await loadPiImportSessions()
            }
            if (failed.length > 0) {
                const first = failed[0]!.error!
                addToast({
                    title: t('piImport.failed.title'),
                    body: t('piImport.failed.partial', {
                        failed: failed.length,
                        reason: formatPiImportError(first.code, first.message)
                    }),
                    sessionId: '',
                    url: ''
                })
                return
            }
            setIsPiImportDialogOpen(false)
            setSelectedPiImportSessionId(null)
        } catch (importError) {
            addToast({
                title: t('piImport.failed.title'),
                body: importError instanceof Error ? importError.message : t('piImport.failed.body'),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsBulkImportingPiSessions(false)
        }
    }, [
        addToast,
        formatPiImportError,
        isBulkImportingPiSessions,
        isLoadingPiImportSessions,
        loadPiImportSessions,
        machineId,
        piImportMachineId,
        props.api,
        refetchSessions,
        t,
        trimmedDirectory
    ])

    const selectedCodexImportSession = useMemo(
        () => codexImportSessions.find((session) => session.id === selectedCodexImportSessionId) ?? null,
        [codexImportSessions, selectedCodexImportSessionId]
    )
    const selectedPiImportSession = useMemo(
        () => piImportSessions.find((session) => session.id === selectedPiImportSessionId) ?? null,
        [piImportSessions, selectedPiImportSessionId]
    )
    // Pi history import reopens the native session as-is; the launch-only
    // model/effort controls would silently not apply, so hide them.
    const showPiLaunchConfig = agent !== 'pi' || !selectedPiImportSession
    const catalogDefaultModelId = agent === 'grok' ? grokModelsState.currentModelId
        : agent === 'kimi' ? kimiModelsState.currentModelId
            : agent === 'pi' ? piModelsState.currentModelId : null
    const launchModelOptions = agent === 'codex' ? codexModelOptions
        : agent === 'grok' ? grokModelOptions
            : agent === 'copilot' ? copilotModelOptions
                : agent === 'kimi' ? kimiModelOptions
                    : agent === 'pi' && showPiLaunchConfig ? piModelOptions : MODEL_OPTIONS[agent]
    const nativeDefaultModelName = configuredDefaultModelName
        ?? launchModelOptions.find((option) => option.value === catalogDefaultModelId)?.label
        ?? catalogDefaultModelId
    const namedLaunchModelOptions = launchModelOptions
        .filter((option) => option.value === 'auto' || option.value !== catalogDefaultModelId || model === option.value)
        .map((option) => option.value === 'auto' && nativeDefaultModelName ? { ...option, label: nativeDefaultModelName } : option)

    const handleAgentChange = useCallback((newAgent: AgentType) => {
        preserveRestoredDraftRef.current = false
        setAgent(newAgent)
    }, [])

    const handleMachineChange = useCallback((newMachineId: string) => {
        preserveRestoredDraftRef.current = false
        setMachineId(newMachineId)
        setModel('auto')
        setCursorSelectedBase('auto')
        setSelectedCodexImportSessionId(null)
        setCodexImportSessions([])
        setCodexImportMachineId(null)
        setSelectedPiImportSessionId(null)
        setPiImportSessions([])
        setPiImportMachineId(null)
        const machine = props.machines.find((candidate) => candidate.id === newMachineId)
        setDirectory(machine
            ? resolveDefaultMachineDirectory(machine, getRecentProjectPaths(sessions, newMachineId))
            : '')
    }, [sessions, props.machines])

    const handleCursorBaseChange = useCallback((baseKey: string) => {
        if (baseKey === 'auto' || baseKey === 'default[]') {
            pendingCursorBaseRef.current = null
            setCursorSelectedBase(baseKey)
            setModel(baseKey)
            return
        }
        setCursorSelectedBase(baseKey)
        if (cursorModelsState.isLoading || cursorPicker.catalog.variantsByBase.size === 0) {
            pendingCursorBaseRef.current = baseKey
            return
        }
        pendingCursorBaseRef.current = null
        setModel(resolveWireIdForBaseChange(baseKey, cursorPicker.catalog, model) ?? 'auto')
    }, [cursorModelsState.isLoading, cursorPicker.catalog, model])

    const handleCursorEffortChange = useCallback((wireId: string) => {
        if (wireId === 'auto') {
            setModel('auto')
            return
        }
        const baseKey = cursorSelectedBase !== 'auto'
            ? cursorSelectedBase
            : cursorPicker.baseKey
        if (baseKey && !isCursorEffortWireAllowed(wireId, cursorPicker.catalog, baseKey)) {
            return
        }
        setModel(wireId)
    }, [cursorPicker.catalog, cursorPicker.baseKey, cursorSelectedBase])

    const handleChooseFolderClick = useCallback(() => {
        if (!props.onChooseFolder) {
            return
        }
        saveNewSessionFormDraft({
            groupId: props.groupId,
            groupCreation: createGroup ? {
                name: groupName.trim(),
                requestId: groupRequestRef.current?.name === groupName.trim() ? groupRequestRef.current.requestId : crypto.randomUUID(),
            } : undefined,
            agent,
            model: agent === 'agy'
                ? (agySelectedModel ?? 'auto')
                : agent === 'opencode'
                    ? (opencodeSelectedModel ?? 'auto')
                    : model,
            cursorSelectedBase,
            machineId,
            effort,
            modelReasoningEffort,
            serviceTier,
            collaborationMode,
            copilotAgentMode,
            yoloMode,
            nativePermissionMode,
            grokPermissionMode,
            sessionType,
            worktreeName
        })
        props.onChooseFolder({ machineId, directory: trimmedDirectory })
    }, [
        props.onChooseFolder,
        props.groupId,
        createGroup,
        groupName,
        agent,
        model,
        opencodeSelectedModel,
        agySelectedModel,
        cursorSelectedBase,
        machineId,
        effort,
        modelReasoningEffort,
        serviceTier,
        collaborationMode,
        copilotAgentMode,
        yoloMode,
        nativePermissionMode,
        grokPermissionMode,
        sessionType,
        worktreeName,
        trimmedDirectory
    ])

    const handleSelectCodexImportSession = useCallback((session: CodexLocalSessionSummary) => {
        setSelectedCodexImportSessionId(session.id)
        if (session.cwd?.trim()) {
            setDirectory(session.cwd.trim())
        }
    }, [])

    const handleSelectPiImportSession = useCallback((session: PiLocalSessionSummary) => {
        setSelectedPiImportSessionId(session.id)
        if (session.cwd?.trim()) setDirectory(session.cwd.trim())
    }, [])

    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        setSuppressSuggestions(false)
        setDirectory(value)
    }, [])

    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    async function handleCreate() {
        if (!machineId || !trimmedDirectory || createInFlightRef.current) return

        createInFlightRef.current = true
        setIsCreating(true)
        setError(null)
        try {
            if (!selectedAgentAvailable) {
                haptic.notification('error')
                setError(t('newSession.agentUnavailable'))
                return
            }
            const existsResult = await checkPathsExists([trimmedDirectory])
            if (existsResult.outsideWorkspaceRoots?.includes(trimmedDirectory)) {
                haptic.notification('error')
                setError(t('newSession.directoryOutsideWorkspaceRoots'))
                return
            }
            const directoryExists = existsResult.exists[trimmedDirectory]

            if (sessionType === 'worktree' && directoryExists === false) {
                haptic.notification('error')
                setError(t('session.directoryMissingWorktree'))
                return
            }

            if (sessionType === 'simple' && directoryExists === false && !directoryCreationConfirmed) {
                setDirectoryCreationConfirmed(true)
                return
            }

            if (
                agent === 'cursor'
                && cursorPicker.mode === 'dual'
                && cursorBaseSelectValue !== 'auto'
                && cursorBaseSelectValue !== 'default[]'
                && cursorVariantOptions.length > 1
                && !cursorVariantOptions.some((option) => option.value === model)
            ) {
                haptic.notification('error')
                setError(t('newSession.model.selectVariant'))
                return
            }

            const resolvedModel = agent === 'opencode'
                ? (opencodeSelectedModel ?? undefined)
                : agent === 'agy'
                    ? (agySelectedModel ?? undefined)
                    : agent === 'cursor'
                        ? (model === 'auto' || !model ? undefined : model)
                        : (model !== 'auto' ? model : undefined)
            // GLM has no effort levels: a branded claude never passes one,
            // even if a remembered value was restored before the flag arrived.
            const resolvedEffort = ((agent === 'claude' && !claudeGlmBranded) || agent === 'grok' || agent === 'pi') && effort !== 'auto'
                ? effort
                : undefined
            const resolvedModelReasoningEffort = agent === 'opencode'
                ? 'max'
                : agent === 'codex' && modelReasoningEffort !== 'default'
                    ? modelReasoningEffort
                    : undefined
            const preferredLaunchSettings = {
                model: agent === 'agy'
                    ? (agySelectedModel ?? 'auto')
                    : agent === 'opencode'
                        ? (opencodeSelectedModel ?? 'auto')
                        : model,
                cursorSelectedBase,
                effort,
                modelReasoningEffort,
                ...(usesSharedPermissionMode ? { permissionMode: nativePermissionMode } : {})
            }
            const resolvedServiceTier = agent === 'codex' && showCodexFastMode
                ? serviceTier
                : undefined
            const resolvedCollaborationMode = agent === 'codex' && collaborationMode !== 'default'
                ? collaborationMode
                : undefined

            let targetGroupId = props.groupId
            if (!targetGroupId && createGroup) {
                const name = groupName.trim()
                if (!name || name.length > 120) { setError(t('groups.invalidName')); return }
                if (groupRequestRef.current?.name !== name) groupRequestRef.current = { name, requestId: crypto.randomUUID() }
                const { group } = await props.api.createGroup(name, groupRequestRef.current.requestId)
                setCreatedGroup(group)
                targetGroupId = group.id
            }

            const finishImportedSession = async (sessionId: string) => {
                if (!props.groupId && targetGroupId) {
                    try {
                        await props.api.addGroupChat(targetGroupId, sessionId)
                    } catch (error) {
                        addToast({ title: t('groups.addFailed'), body: error instanceof Error ? error.message : '', sessionId, url: `/sessions/${sessionId}` })
                    }
                }
                props.onSuccess(sessionId)
            }

            if (agent === 'codex' && selectedCodexImportSession) {
                setIsImportingCodexSession(true)
                const result = await props.api.syncCodexSession({
                    sessionIds: [selectedCodexImportSession.id],
                    cwd: selectedCodexImportSession.cwd ?? trimmedDirectory,
                    machineId: codexImportMachineId ?? machineId,
                    model: resolvedModel ?? null,
                    modelReasoningEffort: resolvedModelReasoningEffort ?? null,
                    serviceTier: resolvedServiceTier,
                    collaborationMode: resolvedCollaborationMode ?? 'default',
                    yolo: nativePermissionMode === 'yolo'
                })
                if (result.success) {
                    const importedSessionId = result.hapiSessionIds?.[0]
                    if (!importedSessionId) {
                        throw new Error('Imported session id missing')
                    }
                    // 中文注释：Codex transcript 导入只会创建 Hapi 记录，不会自动启动 agent。
                    // 这里立刻 resume，避免进入会话页时先看到离线，等首条消息才触发启动。
                    const resumedSessionId = await props.api.resumeSession(
                        importedSessionId,
                        nativePermissionMode !== 'default'
                            ? { permissionMode: nativePermissionMode }
                            : undefined
                    )
                    haptic.notification('success')
                    markCodexSessionsImported([selectedCodexImportSession.id])
                    savePreferredLaunchSettings(machineId, agent, preferredLaunchSettings)
                    clearNewSessionFormDraft()
                    setLastUsedMachineId(machineId)
                    await finishImportedSession(resumedSessionId)
                    return
                }
                setIsImportingCodexSession(false)
                haptic.notification('error')
                setError(result.error || result.message || t('codexSync.failed.body'))
                return
            }

            if (agent === 'pi' && selectedPiImportSession) {
                setIsImportingPiSession(true)
                const result = await props.api.importPiSessions({
                    sessionIds: [selectedPiImportSession.id],
                    cwd: selectedPiImportSession.cwd ?? trimmedDirectory,
                    machineId: piImportMachineId ?? machineId
                })
                const imported = result.results.find((item) => item.piSessionId === selectedPiImportSession.id)
                if (imported?.error) {
                    setIsImportingPiSession(false)
                    haptic.notification('error')
                    setError(formatPiImportError(imported.error.code, imported.error.message))
                    return
                }
                if (!imported?.hapiSessionId) throw new Error(result.error || t('piImport.failed.body'))
                const reopened = await props.api.reopenSession(imported.hapiSessionId)
                haptic.notification('success')
                savePreferredLaunchSettings(machineId, agent, preferredLaunchSettings)
                clearNewSessionFormDraft()
                setLastUsedMachineId(machineId)
                await finishImportedSession(reopened.sessionId)
                return
            }

            const result = await spawnSession({
                groupId: targetGroupId,
                machineId,
                directory: trimmedDirectory,
                agent,
                model: resolvedModel,
                effort: resolvedEffort,
                modelReasoningEffort: resolvedModelReasoningEffort,
                yolo: agent === 'dsh' || usesNativeSelect ? undefined : yoloMode,
                permissionMode: agent === 'grok'
                    ? grokPermissionMode
                    : usesSharedPermissionMode
                        ? nativePermissionMode
                        : undefined,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined,
                serviceTier: resolvedServiceTier,
                collaborationMode: resolvedCollaborationMode,
                copilotAgentMode: agent === 'copilot' ? copilotAgentMode : undefined,
            })


            if (result.type === 'success') {
                if (continueFrom) {
                    try {
                        await props.api.sendMessage(
                            result.sessionId,
                            `${buildSessionReferenceText(getSessionTitle(continueFrom), continueFrom.id)} Continue the work from that session in this project directory.`,
                            makeClientSideId('local')
                        )
                    } catch (sendError) {
                        addToast({
                            title: t('newSession.continue.sendFailed.title'),
                            body: sendError instanceof Error ? sendError.message : t('dialog.error.default'),
                            sessionId: result.sessionId,
                            url: `/sessions/${result.sessionId}`,
                        })
                    }
                }
                haptic.notification('success')
                savePreferredLaunchSettings(machineId, agent, preferredLaunchSettings)
                clearNewSessionFormDraft()
                setLastUsedMachineId(machineId)
                props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            setIsImportingCodexSession(false)
            setIsImportingPiSession(false)
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to create session')
        } finally {
            createInFlightRef.current = false
            setIsCreating(false)
        }
    }

    const isLaunchPreferenceValidationPending =
        (agent === 'codex'
            && (model !== 'auto' || modelReasoningEffort !== 'default')
            && codexModelsState.isLoading)
        || (agent === 'agy'
            && agySelectedModel !== null
            && agySelectedModel !== AGY_HIGH_MODEL_ID
            && agyModelsState.isLoading)
        || (agent === 'cursor'
            && model !== 'default[]'
            && (model !== 'auto' || cursorSelectedBase !== 'auto')
            && cursorModelsState.isLoading)
        || (agent === 'grok'
            && deferredDirectory !== ''
            && (model !== 'auto' || effort !== 'auto')
            && (
                deferredDirectoryExists === undefined
                || (deferredDirectoryExists === true && grokModelsState.isLoading)
            ))
        || (agent === 'opencode'
            && deferredDirectory !== ''
            && Boolean(opencodeSelectedModel)
            && (
                deferredDirectoryExists === undefined
                || (deferredDirectoryExists === true && opencodeModelsState.isLoading)
            ))
        || (opencodeCatalogPending && modelReasoningEffort !== 'default')
        || (agent === 'copilot'
            && model !== 'auto'
            && (
                deferredDirectoryExists === undefined
                || (deferredDirectoryExists === true && copilotModelsState.isLoading)
            ))
        || (agent === 'kimi'
            && deferredDirectory !== ''
            && model !== 'auto'
            && (
                deferredDirectoryExists === undefined
                || (deferredDirectoryExists === true && kimiModelsState.isLoading)
            ))
        || (agent === 'pi'
            && model !== 'auto'
            && piModelsState.isLoading)
    const fastModeSelectionPending = agent === 'codex'
        && serviceTier === 'fast'
        && codexModelsState.isLoading
    const canCreate = Boolean(
        machineId
        && trimmedDirectory
        && !isFormDisabled
        && !missingWorktreeDirectory
        && !directoryOutsideWorkspaceRoots
        && !agentAvailability.isLoading
        && !agentAvailability.error
        && selectedAgentAvailable
        && !isLaunchPreferenceValidationPending
        && !fastModeSelectionPending
        && (!createGroup || (groupName.trim().length > 0 && groupName.trim().length <= 120))
    )

    return (
        <div className="flex flex-col divide-y divide-[var(--app-divider)] [&>div]:pr-[10px] lg:[&>div]:pr-3">
            {continueFrom ? (
                <div className="px-3 py-2 text-sm text-[var(--app-hint)]">
                    {t('newSession.continue.description', { title: getSessionTitle(continueFrom) })}
                </div>
            ) : null}
            <div className="px-3 py-3 text-sm">
                {props.groupId || createdGroup ? <p className="text-[var(--app-hint)]">{t('groups.newChatIn', { name: props.groupName ?? createdGroup?.name ?? '' })}</p> : <>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={createGroup} disabled={isFormDisabled} onChange={event => setCreateGroup(event.target.checked)} className="h-4 w-4 accent-[var(--app-link)]" />
                        {t('groups.createWithChat')}
                    </label>
                    {createGroup ? <div className="mt-3 flex flex-col gap-1 text-xs text-[var(--app-hint)]">
                        <label htmlFor="new-group-name">{t('groups.name')}</label>
                        <input id="new-group-name" aria-describedby="new-group-description" value={groupName} maxLength={120} disabled={isFormDisabled} onChange={event => setGroupName(event.target.value)} placeholder={t('groups.namePlaceholder')}
                            className="min-h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-base text-[var(--app-fg)]" />
                        <p id="new-group-description">{t('groups.firstChatHint')}</p>
                    </div> : null}
                </>}
                {props.groupDefaultsUnavailable || (props.initialAgent && !agentAvailability.isLoading && !agentAvailability.error && !availableAgents.includes(props.initialAgent)) ? <p role="status" className="mt-2 text-xs text-[var(--app-hint)]">{t('groups.defaultsUnavailable')}</p> : null}
            </div>
            {/* Fork: a single-machine setup needs no picker; it would only be
                one more thing to scroll past on the phone. */}
            {props.machines.length > 1 ? (
                <MachineSelector
                    machines={props.machines}
                    machineId={machineId}
                    isLoading={props.isLoading}
                    isDisabled={isFormDisabled}
                    onChange={handleMachineChange}
                />
            ) : null}
            {runnerSpawnError ? (
                <div className="px-3 py-2 text-xs text-red-600">
                    Runner last spawn error: {runnerSpawnError}
                </div>
            ) : null}
            <DirectorySection
                directory={directory}
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                isDisabled={isFormDisabled}
                workPaths={workPaths}
                recentPaths={filteredRecentPaths}
                statusMessage={directoryStatusMessage}
                statusTone={directoryStatusTone}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
                onChooseFolder={props.onChooseFolder ? handleChooseFolderClick : undefined}
            />
            {/* Fork: worktree launches are never used here, so the type
                selector is not rendered — sessions always launch in place
                (`sessionType` stays 'simple'; the draft restore clamps it). */}
            <AgentSelector
                agent={agent}
                agents={availableAgents}
                isDisabled={isFormDisabled || agentAvailability.isLoading || Boolean(agentAvailability.error)}
                onAgentChange={handleAgentChange}
            />
            {agentAvailability.isLoading ? (
                <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                    {t('newSession.agentAvailabilityLoading')}
                </div>
            ) : agentAvailability.error ? (
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-red-600">
                    <span>
                        {agentAvailability.upgradeRequired
                            ? t('newSession.runnerUpgradeRequired')
                            : t('newSession.agentAvailabilityFailed')}
                    </span>
                    <button type="button" className="underline" onClick={agentAvailability.refetch}>
                        {t('button.retry')}
                    </button>
                </div>
            ) : availableAgents.length === 0 ? (
                <div className="px-3 py-2 text-xs text-red-600">
                    {t('newSession.noAvailableAgents')}
                </div>
            ) : null}
            {/* Fork: codex history import is never used here, so its entry
                point is not rendered; the plumbing stays dormant. */}
            {agent === 'pi' ? (
                <PiImportActions
                    selectedSession={selectedPiImportSession}
                    isLoading={isLoadingPiImportSessions}
                    isDisabled={isFormDisabled}
                    error={piImportError}
                    onChooseHistory={() => {
                        setIsPiImportDialogOpen(true)
                        void loadPiImportSessions()
                    }}
                    onClear={() => setSelectedPiImportSessionId(null)}
                />
            ) : null}
            {agent === 'dsh' ? null : agent === 'agy' ? (
                <>
                    <ModelBadges
                        options={[
                            { value: 'auto', label: AGY_HARDCODED_LABEL },
                            { value: AGY_HIGH_MODEL_ID, label: AGY_HIGH_MODEL_LABEL },
                        ]}
                        activeValue={agySelectedModel ?? 'auto'}
                        isDisabled={isFormDisabled || !machineId}
                        onToggle={(value) => {
                            agyModelPickedByUserRef.current = value !== 'auto'
                            setAgySelectedModel(value === 'auto' ? null : value)
                        }}
                        footer={showAllModels ? null : (
                            <OtherModelsButton
                                isDisabled={isFormDisabled || !machineId}
                                onClick={() => setShowAllModels(true)}
                            />
                        )}
                    />
                    {showAllModels ? (
                        <AgyModelSelector
                            machineId={machineId}
                            isLoading={agyModelsState.isLoading}
                            error={agyModelsState.error}
                            warning={agyModelsState.warning}
                            isFetching={agyModelsState.isFetching}
                            availableModels={agyModelsState.availableModels}
                            defaultModelName={configuredDefaultModelName}
                            selectedModel={agySelectedModel}
                            onModelChange={(modelId) => {
                                agyModelPickedByUserRef.current = modelId !== null
                                setAgySelectedModel(modelId)
                            }}
                            onRetry={agyModelsState.refetch}
                        />
                    ) : null}
                </>
            ) : agent === 'opencode' ? (
                <>
                    <ModelBadges
                        options={OPENCODE_HARDCODED_OPTIONS}
                        activeValue={opencodeSelectedModel ?? 'auto'}
                        isDisabled={isFormDisabled || !machineId}
                        onToggle={(value) => setOpencodeSelectedModel(value === 'auto' ? null : value)}
                        footer={showAllModels ? null : (
                            <OtherModelsButton
                                isDisabled={isFormDisabled || !machineId}
                                onClick={() => {
                                    setShowAllModels(true)
                                    setRequestedModelCatalog(modelCatalogTarget)
                                }}
                            />
                        )}
                    />
                    {showAllModels ? (
                        <OpencodeModelSelector
                            cwd={deferredDirectory}
                            machineId={machineId}
                            isLoading={opencodeModelsState.isLoading}
                            error={opencodeModelsState.error}
                            availableModels={opencodeModelsState.availableModels}
                            currentModelId={opencodeModelsState.currentModelId}
                            defaultModelName={configuredDefaultModelName}
                            selectedModel={opencodeSelectedModel}
                            onModelChange={setOpencodeSelectedModel}
                            onRetry={opencodeModelsState.refetch}
                            onLoadModels={!modelCatalogRequested ? () => setRequestedModelCatalog(modelCatalogTarget) : undefined}
                            canLoadModels={deferredDirectoryExists === true}
                        />
                    ) : null}
                </>
            ) : (
                agent === 'cursor' ? (
                    <>
                        <div className="flex flex-col gap-1.5 px-3 py-3">
                            <span className="text-xs font-medium text-[var(--app-hint)]">
                                {t('newSession.model')}
                            </span>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                                <QuickPickChips
                                    options={hardcodedCursorOptions}
                                    activeValue={cursorSpeedOptions?.standard ?? CURSOR_GROK_XHIGH_WIRE}
                                    isDisabled={isFormDisabled || !machineId}
                                    onToggle={(value) => {
                                        setModel(cursorServiceTier === 'fast' ? `${value}-fast` : value)
                                        setCursorSelectedBase(value === CURSOR_COMPOSER_STANDARD_WIRE ? 'composer-2.5' : 'grok-4.7')
                                    }}
                                />
                                {showAllCursorModels ? null : (
                                    <OtherModelsButton
                                        isDisabled={isFormDisabled || !machineId}
                                        onClick={() => {
                                            setShowAllCursorModels(true)
                                            setRequestedModelCatalog(modelCatalogTarget)
                                        }}
                                    />
                                )}
                            </div>
                            {cursorModelsState.error ? (
                                <button type="button" onClick={cursorModelsState.refetch} className="self-start rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]">
                                    {t('newSession.opencodeModel.retry')}
                                </button>
                            ) : null}
                        </div>
                        {showAllCursorModels ? (
                            <>
                                <ModelSelector
                                    agent={agent}
                                    model={cursorPicker.mode === 'dual' ? cursorBaseSelectValue : model}
                                    options={[
                                        ...cursorPicker.modelOptions.map((option) => option.value === 'auto'
                                            ? { ...option, label: cursorDefaultModelName ?? t('newSession.model.default') } : option),
                                        { value: 'default[]', label: 'Auto' }
                                    ]}
                                    isDisabled={cursorModelPickersDisabled}
                                    isLoading={false}
                                    error={cursorModelsState.error
                                        ? `${t('newSession.model.loadFailed')}: ${cursorModelsState.error}`
                                        : null}
                                    onModelChange={(value) => {
                                        if (cursorPicker.mode === 'dual') {
                                            handleCursorBaseChange(value)
                                            return
                                        }
                                        setModel(value)
                                        setCursorSelectedBase(
                                            value === 'auto' || value === 'default[]' ? value : resolveCursorBaseFromWire(value, cursorPicker.catalog)
                                        )
                                    }}
                                >
                                    {!modelCatalogRequested ? (
                                        <button
                                            type="button"
                                            onClick={() => setRequestedModelCatalog(modelCatalogTarget)}
                                            disabled={isFormDisabled || !machineId}
                                            className="self-start rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                                        >
                                            {t('newSession.model.loadOptions')}
                                        </button>
                                    ) : null}
                                    {cursorModelsUnavailable ? (
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {t('newSession.model.cursorUnavailable')}
                                        </div>
                                    ) : null}
                                </ModelSelector>
                                {showCursorVariantPicker ? (
                                    <ModelSelector
                                        agent={agent}
                                        model={cursorEffortSelectValue}
                                        label={t('misc.variant')}
                                        options={cursorVariantSelectOptions}
                                        isDisabled={cursorModelPickersDisabled}
                                        isLoading={cursorModelsState.isLoading}
                                        onModelChange={handleCursorEffortChange}
                                    />
                                ) : null}
                            </>
                        ) : null}
                    </>
                ) :                 agent === 'codex' ? (
                    <>
                        <ModelBadges
                            options={[...CODEX_HARDCODED_OPTIONS]}
                            activeValue={CODEX_HARDCODED_OPTIONS.some((option) => option.value === model) ? model : CODEX_DEFAULT_MODEL_ID}
                            isDisabled={isFormDisabled || Boolean(codexModelsState.error)}
                            onToggle={(value) => setModel(value)}
                            footer={showAllModels ? null : (
                                <OtherModelsButton
                                    isDisabled={isFormDisabled || !machineId}
                                    onClick={() => setShowAllModels(true)}
                                />
                            )}
                        />
                        {showAllModels ? (
                            <ModelSelector
                                agent={agent}
                                model={model}
                                options={codexModelOptions}
                                isDisabled={isFormDisabled || Boolean(codexModelsState.error)}
                                isLoading={codexModelsState.isLoading}
                                error={codexModelsState.error
                                    ? `${t('newSession.model.loadFailed')}: ${codexModelsState.error}`
                                    : null}
                                onModelChange={setModel}
                            />
                        ) : null}
                    </>
                ) : agent === 'claude' && claudeGlmBranded ? (
                    <ModelBadges
                        options={[
                            { value: 'auto', label: CLAUDE_GLM_HARDCODED_LABEL },
                            { value: CLAUDE_GLM_MODEL_ID, label: CLAUDE_GLM_MODEL_LABEL },
                        ]}
                        activeValue={model}
                        isDisabled={isFormDisabled || !machineId}
                        onToggle={setModel}
                    />
                ) : agent === 'minimax' ? (
                    <ModelBadges
                        options={[{ value: 'auto', label: MINIMAX_HARDCODED_LABEL }]}
                        activeValue="auto"
                        isDisabled={isFormDisabled || !machineId}
                        onToggle={() => {}}
                    />
                ) : (
                    <ModelSelector
                        agent={agent}
                        model={model}
                        options={namedLaunchModelOptions}
                        isDisabled={
                            isFormDisabled
                            || (agent === 'grok' && Boolean(grokModelsState.error))
                            || (agent === 'copilot' && Boolean(copilotModelsState.error))
                            || (agent === 'kimi' && Boolean(kimiModelsState.error))
                            || (agent === 'pi' && Boolean(piModelsState.error))
                        }
                        isLoading={(agent === 'grok' && grokModelsState.isLoading)
                            || (agent === 'copilot' && copilotModelsState.isLoading)
                            || (agent === 'kimi' && kimiModelsState.isLoading)
                            || (agent === 'pi' && piModelsState.isLoading)}
                        error={agent === 'grok' && grokModelsState.error
                                ? `${t('newSession.model.loadFailed')}: ${grokModelsState.error}`
                                : agent === 'copilot' && copilotModelsState.error
                                    ? `${t('newSession.model.loadFailed')}: ${copilotModelsState.error}`
                                    : agent === 'kimi' && kimiModelsState.error
                                        ? `${t('newSession.model.loadFailed')}: ${kimiModelsState.error}`
                                        : agent === 'pi' && piModelsState.error
                                            ? `${t('newSession.model.loadFailed')}: ${piModelsState.error}`
                                    : null}
                        onModelChange={setModel}
                    />
                )
            )}
            {showPiLaunchConfig && !(agent === 'claude' && claudeGlmBranded) ? (
                <EffortField
                    agent={agent}
                    effort={effort}
                    onEffortChange={setEffort}
                    reasoningEffort={modelReasoningEffort}
                    onReasoningEffortChange={setModelReasoningEffort}
                    isDisabled={isFormDisabled || (agent === 'codex' && codexModelsState.isLoading)}
                    grokOptions={agent === 'grok' ? grokEffortOptions : undefined}
                    opencodeVariantOptions={agent === 'opencode' ? opencodeVariantOptions : undefined}
                    piSelectedModel={agent === 'pi' ? piSelectedModel : null}
                />
            ) : null}
            <FastModeSelector
                visible={showCodexFastMode || Boolean(cursorSpeedOptions)}
                value={agent === 'cursor' ? cursorServiceTier : serviceTier}
                isDisabled={isFormDisabled || (agent === 'codex' && codexModelsState.isLoading)}
                onChange={(value) => {
                    if (cursorSpeedOptions) {
                        setModel(cursorSpeedOptions[value])
                    } else {
                        setServiceTier(value)
                    }
                }}
            />
            {/* Fork: the collaboration-mode selector is dormant — codex
                launches with its own default mode and the field stays out of
                the form. State/plumbing remain for a future restore. */}
            <CopilotAgentModeSelector
                agent={agent}
                value={copilotAgentMode}
                isDisabled={isFormDisabled}
                onChange={setCopilotAgentMode}
            />

            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            <ActionButtons
                isPending={isCreating || isPending || isImportingCodexSession || isImportingPiSession}
                canCreate={canCreate}
                isDisabled={isFormDisabled}
                createLabel={createLabel}
                onCancel={props.onCancel}
                onCreate={handleCreate}
            />
            <CodexSessionSyncDialog
                isOpen={isCodexImportDialogOpen}
                onClose={() => setIsCodexImportDialogOpen(false)}
                sessions={codexImportSessions}
                currentCodexSessionId={selectedCodexImportSessionId}
                currentWorkDirectory={trimmedDirectory}
                selectionMode="multiple"
                onConfirm={async (sessionIds) => {
                    if (sessionIds.length === 1) {
                        const session = codexImportSessions.find((candidate) => candidate.id === sessionIds[0])
                        if (session) {
                            handleSelectCodexImportSession(session)
                            setIsCodexImportDialogOpen(false)
                        }
                        return
                    }
                    await handleBulkImportCodexSessions(sessionIds)
                }}
                onRestartCodexDesktop={handleRestartCodexDesktop}
                onArchiveSession={handleArchiveCodexImportSession}
                isPending={isBulkImportingCodexSessions}
                isRestartingCodexDesktop={isRestartingCodexDesktop}
                isLoading={isLoadingCodexImportSessions}
            />
            <PiSessionImportDialog
                isOpen={isPiImportDialogOpen}
                onClose={() => setIsPiImportDialogOpen(false)}
                sessions={piImportSessions}
                currentSessionId={selectedPiImportSessionId}
                currentWorkDirectory={trimmedDirectory}
                onConfirm={async (sessionIds) => {
                    if (sessionIds.length === 1) {
                        const session = piImportSessions.find((candidate) => candidate.id === sessionIds[0])
                        if (session) {
                            handleSelectPiImportSession(session)
                            setIsPiImportDialogOpen(false)
                        }
                        return
                    }
                    await handleBulkImportPiSessions(sessionIds)
                }}
                isPending={isBulkImportingPiSessions}
                isLoading={isLoadingPiImportSessions}
            />
            <ConfirmDialog
                isOpen={isDuplicateMergeConfirmOpen && duplicateSessionGroups.length > 0}
                onClose={closeDuplicateMergeDialog}
                title={t('codexSync.duplicates.confirm.title')}
                description={t('codexSync.duplicates.confirm.description')}
                confirmLabel={t('codexSync.duplicates.confirm.confirm')}
                confirmingLabel={t('codexSync.duplicates.confirm.confirming')}
                onConfirm={handleMergeDuplicateSessions}
                isPending={isMergingDuplicateSessions}
                centerTitle
            />
        </div>
    )
}
