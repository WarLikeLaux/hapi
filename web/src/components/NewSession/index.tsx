import { useProjectPreferences } from '@/hooks/useProjectPreferences'
import { ProjectManager } from './ProjectManager'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ApiClient } from '@/api/client'
import type { CodexDuplicateSessionGroup, CodexLocalSessionSummary, Machine, PiLocalSessionSummary, Session } from '@/types/api'
import { MUSE_SPARK_MODEL_ID, getDefaultOpencodeReasoningEffort, isKnownFlavor, isRemovedAgyModel, resolveHapiYoloPermissionMode, type CodexCollaborationMode, type GrokPermissionMode, type PermissionMode, type CopilotAgentMode } from '@hapi/protocol'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { formatCodexReasoningEffortLabel } from '@/components/AssistantChat/codexReasoningEffortOptions'
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
import { modelChipText } from '@/lib/modelChipLabel'
import {
    buildNewSessionCursorModelCatalog,
    CURSOR_COMPOSER_STANDARD_WIRE,
    CURSOR_GROK_XHIGH_WIRE,
    cursorSelectionIsFast,
    getCursorModelSpeedOptions,
    isHardcodedCursorModelId,
    resolveCursorQuickPickValue,
} from './newSessionCursorModels'
import {
    clearNewSessionFormDraft,
    loadNewSessionFormDraft,
    newSessionDraftMatchesMachine,
    saveNewSessionFormDraft,
    shouldRestoreNewSessionFormDraft
} from './newSessionFormDraft'
import { isOpencodeReasoningEffortValid, MODEL_OPTIONS } from './types'
import type { NewSessionFormDraft } from './newSessionFormDraft'
import { INITIAL_IMAGE_AGENTS, type LaunchSessionRequest } from '@hapi/protocol'
import { InitialPrompt } from './InitialPrompt'
import type { InitialImageDraft } from './initialImageDrafts'
import type { AgentType, LaunchEffort, CodexReasoningEffort, NewSessionServiceTier, SessionType } from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { ModelChoices, modelChoiceLabel, type ModelChoice } from './ModelChoices'
import { ChoiceLabel } from './ChoiceLabel'
import { useNarrowViewport } from '@/hooks/useNarrowViewport'
import { PiImportActions } from './PiImportActions'
import { clearBatchImportedCodexSelection, resolveCodexImportRedirectSessionId } from './codexImportMerge'
import { DirectorySection } from './DirectorySection'
import { CopilotAgentModeSelector } from './CopilotAgentModeSelector'
import { FastModeSelector } from './FastModeSelector'
import { MachineSelector } from './MachineSelector'
import { ModelSelector } from './ModelSelector'
import { EffortField } from './EffortField'
import { ModelManager } from './ModelManager'
import { useModelPreferences } from './useModelPreferences'
import { shouldEnableOpencodeModelDiscovery } from './opencodeModelsGate'
import { buildGrokEffortOptions, buildGrokModelOptions, shouldEnableGrokModelDiscovery } from './grokModels'
import { buildKimiModelOptions, shouldEnableKimiModelDiscovery } from './grokModels'
import { groupModelsByProvider } from '@/components/AssistantChat/piModelGroups'
import { isThinkingLevelSupported } from '@/components/AssistantChat/piThinkingLevelOptions'
import {
    loadPreferredYoloMode,
    savePreferredYoloMode,
} from './preferences'
import {
    AGY_HIGH_MODEL_ID,
    AGY_HIGH_MODEL_LABEL,
    CLAUDE_GLM_HARDCODED_LABEL,
    CLAUDE_GLM_MODEL_ID,
    CLAUDE_GLM_MODEL_LABEL,
    CODEX_HARDCODED_OPTIONS,
    CODEX_DEFAULT_MODEL_ID,
    MINIMAX_HARDCODED_LABEL,
    OPENCODE_HARDCODED_LABEL,
    OPENCODE_HARDCODED_MODEL_ID,
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

export type SessionEditorState = {
    input: Omit<LaunchSessionRequest, 'requestId' | 'initialPrompt' | 'initialImages'>
    draft: NewSessionFormDraft
    canCreate: boolean
    modelLabel: string
}

function codexCreateModelOrDefault(model: string | null | undefined): string {
    return !model || model === 'auto' || model === 'gpt-6-astra'
        ? CODEX_DEFAULT_MODEL_ID : model
}

export function NewSession(props: {
    onAddChat?: (state: SessionEditorState) => void
    onStartChat?: (state: SessionEditorState) => void
    initialDraft?: NewSessionFormDraft
    editor?: {
        initialDraft?: NewSessionFormDraft
        disabled: boolean
        onChange: (state: SessionEditorState) => void
    }
    groupId?: string
    groupName?: string
    initialAgent?: AgentType
    groupDefaultsUnavailable?: boolean
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string, alreadyPlaced?: boolean) => void
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
    const { sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useSessions(props.api)
    const projectPreferences = useProjectPreferences(props.api)
    const [projectManagerOpen, setProjectManagerOpen] = useState(false)
    const defaultApplied = useRef(false)
    const modelPreferences = useModelPreferences(props.api)
    const [modelManagerOpen, setModelManagerOpen] = useState(false)
    const { getLastUsedMachineId, setLastUsedMachineId } = useLastUsedMachine()

    const editorDraft = props.editor?.initialDraft ?? props.initialDraft
    const continueFrom = props.continueFromSession
    const continueAgent = isKnownFlavor(continueFrom?.metadata?.flavor)
        ? continueFrom.metadata.flavor
        : null
    const [machineId, setMachineId] = useState<string | null>(props.initialMachineId ?? null)
    const [directory, setDirectory] = useState(props.initialDirectory ?? '')
    const [initialPrompt, setInitialPrompt] = useState(editorDraft?.initialPrompt ?? '')
    const [initialImages, setInitialImages] = useState<InitialImageDraft[]>(editorDraft?.initialImages ?? [])
    const [readingImages, setReadingImages] = useState(false)
    const [groupName, setGroupName] = useState(editorDraft?.groupCreation?.name ?? '')
    const createGroup = !props.editor && !props.groupId && Boolean(groupName.trim())
    const groupRequestRef = useRef<{ name: string; requestId: string } | null>(editorDraft?.groupCreation ?? null)
    const [createdGroup, setCreatedGroup] = useState<{ id: string; name: string } | null>(null)

    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const isNarrow = useNarrowViewport()
    const [agentFilter, setAgentFilter] = useState<AgentType | 'all'>(editorDraft?.agentFilter ?? 'all')
    const pendingModelChoice = useRef<ModelChoice | null>(null)
    const pendingCursorSpeed = useRef<{ id: string; speed: 'fast' | 'standard' } | null>(null)
    const initialChoicePending = useRef(!editorDraft && !continueFrom && !props.initialAgent)
    const agentChoicePending = useRef<AgentType | null>(null)
    const [agent, setAgent] = useState<AgentType>(() => editorDraft?.agent ?? continueAgent ?? props.initialAgent ?? 'codex')
    const [model, setModel] = useState(() => {
        const restored = editorDraft?.model ?? continueFrom?.model
        return agent === 'codex' && !continueFrom
            ? codexCreateModelOrDefault(restored) : restored ?? 'auto'
    })
    const selectedCustomModel = modelPreferences.preferences.some(row => row.agent === agent && row.modelId === model && row.pinned && !row.hidden)
    const [cursorSelectedBase, setCursorSelectedBase] = useState(editorDraft?.cursorSelectedBase ?? 'auto')
    const [effort, setEffort] = useState<LaunchEffort>(() => editorDraft?.effort ?? continueFrom?.effort ?? 'auto')
    const [modelReasoningEffort, setModelReasoningEffort] = useState<CodexReasoningEffort>(() =>
        editorDraft?.modelReasoningEffort ?? continueFrom?.modelReasoningEffort ?? 'default')
    const [opencodeSelectedModel, setOpencodeSelectedModel] = useState<string | null | undefined>(() => {
        const selected = editorDraft?.agent === 'opencode' ? editorDraft.model : continueAgent === 'opencode' ? continueFrom?.model : null
        return selected && selected !== 'auto' ? selected : null
    })
    const [serviceTier, setServiceTier] = useState<NewSessionServiceTier>(() => {
        const restored = editorDraft?.serviceTier ?? continueFrom?.serviceTier
        return restored === 'fast' || restored === 'standard' ? restored : agent === 'codex' ? 'fast' : 'standard'
    })
    // Fork: the collaboration-mode selector is dormant; a hidden field must
    // not carry a non-default mode into the spawn, so it stays at 'default'.
    const [collaborationMode, setCollaborationMode] = useState<CodexCollaborationMode>('default')
    const [copilotAgentMode, setCopilotAgentMode] = useState<CopilotAgentMode>(() => editorDraft?.copilotAgentMode ?? continueFrom?.copilotAgentMode ?? 'interactive')
    const [yoloMode, setYoloMode] = useState(() => editorDraft?.yoloMode ?? loadPreferredYoloMode())
    // Fork: when the hub brands claude as GLM (z.ai), the flavor has no
    // meaningful effort control and the no-pick model is GLM 5.3 Flash.
    const claudeGlmBranded = useClaudeGlmBranding()
    // Fork: YOLO is the launch default for every flavor — native-select
    // flavors start at their own YOLO-equivalent mode (claude/grok map to
    // bypassPermissions, codex family to yolo).
    const [nativePermissionMode, setNativePermissionMode] = useState<PermissionMode>(() => editorDraft?.nativePermissionMode ?? continueFrom?.permissionMode ?? continueFrom?.metadata?.preferredPermissionMode ?? resolveHapiYoloPermissionMode(continueAgent ?? props.initialAgent ?? 'codex') ?? 'default')
    const [grokPermissionMode, setGrokPermissionMode] = useState<GrokPermissionMode>(editorDraft?.grokPermissionMode ?? 'bypassPermissions')
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
        props.editor?.disabled
        || isCreating
        || isPending
        || props.isLoading
        || isImportingCodexSession
        || isBulkImportingCodexSessions
        || isImportingPiSession
        || isBulkImportingPiSessions
    )
    const worktreeInputRef = useRef<HTMLInputElement>(null)
    const preserveRestoredDraftRef = useRef(Boolean(continueFrom || editorDraft))

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
        setGrokPermissionMode('bypassPermissions')
        setNativePermissionMode(resolveHapiYoloPermissionMode(agent) ?? 'default')
        setServiceTier(agent === 'codex' ? 'fast' : 'standard')
        setCollaborationMode('default')
        setCopilotAgentMode('interactive')
        setModel(agent === 'codex' ? CODEX_DEFAULT_MODEL_ID : 'auto')
        setCursorSelectedBase('auto')
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
        if (continueFrom || props.editor || props.initialDraft) {
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
            setGroupName(draft.groupCreation.name)
            groupRequestRef.current = draft.groupCreation
        }
        restoredFromBrowseRef.current = true
        preserveRestoredDraftRef.current = true
        setInitialPrompt(draft.initialPrompt ?? '')
        setInitialImages(draft.initialImages ?? [])
        setAgent(draft.agent)
        setAgentFilter(draft.agentFilter ?? 'all')
        setModel(draft.agent === 'codex' ? codexCreateModelOrDefault(draft.model) : draft.model)
        setCursorSelectedBase(draft.cursorSelectedBase)
        setEffort(draft.effort)
        setModelReasoningEffort(draft.modelReasoningEffort)
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
        if (!props.machines.length) return
        const selected = props.machines.find(m => m.id === machineId)
            ?? props.machines.find(m => m.id === getLastUsedMachineId())
            ?? props.machines[0]
        if (machineId !== selected.id) setMachineId(selected.id)
        if (defaultApplied.current || projectPreferences.loading || sessionsLoading) return
        if (props.initialDirectory === undefined) {
            setDirectory(projectPreferences.projects.find(p => p.isDefault && p.machineId === selected.id)?.path
                ?? resolveDefaultMachineDirectory(selected, getRecentProjectPaths(sessions, selected.id), projectPreferences.projects.filter(p => p.machineId === selected.id && p.hidden).map(p => p.path)))
        }
        defaultApplied.current = true
    }, [props.machines, machineId, getLastUsedMachineId, sessions, props.initialDirectory, projectPreferences.loading, projectPreferences.projects, sessionsLoading])

    const selectedMachine = useMemo(
        () => (machineId ? props.machines.find((machine) => machine.id === machineId) ?? null : null),
        [machineId, props.machines]
    )
    const agentAvailability = useAgentAvailability({
        api: props.api,
        machineId,
    })
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
    const [agySelectedModel, setAgySelectedModel] = useState<string | null>(editorDraft?.agent === 'agy' && editorDraft.model !== 'auto' ? editorDraft.model : null)
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
    const savedCodexEffort = modelPreferences.preferences.find(row => row.agent === 'codex' && row.modelId === model)?.reasoningEffort
    const effectiveCodexEffort = modelReasoningEffort !== 'default'
        ? modelReasoningEffort
        : savedCodexEffort && (!codexSupportedReasoningEfforts || codexSupportedReasoningEfforts.includes(savedCodexEffort))
            ? savedCodexEffort : 'default'
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
            || modelPreferences.loading
            || codexModelsState.error
        ) {
            return
        }
        if (!codexModelsState.models.some((candidate) => candidate.id === model)
            && !modelPreferences.preferences.some(preference => preference.agent === 'codex' && preference.modelId === model && preference.pinned && !preference.hidden)
            && !CODEX_HARDCODED_OPTIONS.some((option) => option.value === model)) {
            setModel(CODEX_DEFAULT_MODEL_ID)
        }
    }, [agent, codexModelsState.error, codexModelsState.isLoading, codexModelsState.models, model, modelPreferences.loading, modelPreferences.preferences])
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
        if (agent !== 'codex' && !showCodexFastMode && serviceTier !== 'standard') {
            setServiceTier('standard')
        }
    }, [agent, codexModelsState.isLoading, showCodexFastMode, serviceTier])
    useEffect(() => {
        if (agent === 'claude' && claudeGlmBranded && model !== 'auto' && model !== CLAUDE_GLM_MODEL_ID) {
            setModel('auto')
        }
    }, [agent, claudeGlmBranded, model])
    const cursorModelsState = useCursorModelsForMachine({
        api: props.api,
        machineId,
        enabled: agent === 'cursor' && Boolean(machineId)
    })
    const availableCursorCatalog = useMemo(
        () => buildNewSessionCursorModelCatalog(
            cursorModelsState.availableModels,
            'auto',
            cursorModelsState.cliModelSkus
        ),
        [cursorModelsState.availableModels, cursorModelsState.cliModelSkus]
    )
    const cursorEffectiveModel = model === 'auto' ? cursorModelsState.currentModelId : model
    const cursorQuickPick = model === 'auto' || model === 'default[]'
        ? resolveCursorQuickPickValue(cursorModelsState.currentModelId, configuredDefaultModelName)
        : undefined
    const cursorSpeedLookup = cursorQuickPick ?? cursorEffectiveModel ?? 'auto'
    const cursorSpeedOptions = agent === 'cursor' && !cursorModelsState.isLoading && !cursorModelsState.error
        ? getCursorModelSpeedOptions(cursorSpeedLookup, [...cursorModelsState.availableModels, ...cursorModelsState.cliModelSkus])
        : null
    const cursorServiceTier = model === 'auto' || model === 'default[]'
        ? (cursorSelectionIsFast(cursorModelsState.currentModelId, configuredDefaultModelName) ? 'fast' : 'standard')
        : (cursorSpeedOptions?.fast === cursorEffectiveModel ? 'fast' : 'standard')

    useEffect(() => {
        if (
            agent !== 'cursor'
            || cursorModelsState.isLoading
            || cursorModelsState.error
            || modelPreferences.loading
        ) {
            return
        }
        if (model !== 'auto' && model !== 'default[]' && !selectedCustomModel && !isHardcodedCursorModelId(model) && !availableCursorCatalog.wireToBase.has(model)
            && ![...cursorModelsState.availableModels, ...cursorModelsState.cliModelSkus].some(option => option.modelId === model)) {
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
        selectedCustomModel,
        modelPreferences.loading,
        availableCursorCatalog,
        cursorModelsState.error,
        cursorModelsState.isLoading,
        cursorModelsState.availableModels,
        cursorModelsState.cliModelSkus,
        cursorSelectedBase,
        model
    ])

    const recentPaths = useMemo(
        () => getRecentProjectPaths(sessions, machineId),
        [sessions, machineId]
    )

    const hubContextSync = useSessionContextHubSync()
    const { workAliases, projectOverrides } = useSessionContextFilter(hubContextSync)
    const { workPaths, recentPaths: filteredRecentPaths } = useProjectPaths(
        sessions,
        machineId,
        { workAliases, projectOverrides, projects: projectPreferences.projects }
    )

    const trimmedDirectory = directory.trim()
    const deferredDirectory = useDeferredValue(trimmedDirectory)
    const suggestedPaths = useDirectorySuggestions(machineId, sessions, recentPaths)
    const allPaths = useMemo(() => suggestedPaths.filter(path => !projectPreferences.projects.some(p => p.machineId === machineId && p.path === path && p.hidden)), [suggestedPaths, projectPreferences.projects, machineId])
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
        enabled: shouldEnableOpencodeModelDiscovery({
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
        enabled: !opencodeModelsState.isLoading
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
            ? OPENCODE_HARDCODED_MODEL_ID
            : opencodeSelectedModel
        // The native catalog can omit Muse variants that the provider supports.
        if (effectiveModelId === MUSE_SPARK_MODEL_ID) {
            return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
        }
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
    const opencodeEffectiveModelId = !opencodeSelectedModel || opencodeSelectedModel === 'auto'
        ? OPENCODE_HARDCODED_MODEL_ID : opencodeSelectedModel
    const savedOpencodeEffort = modelPreferences.preferences.find(row => row.agent === 'opencode' && row.modelId === opencodeEffectiveModelId)?.reasoningEffort
    const opencodeDefaultEffort = savedOpencodeEffort ?? getDefaultOpencodeReasoningEffort(opencodeEffectiveModelId)
    const effectiveOpencodeEffort = modelReasoningEffort !== 'default'
        ? modelReasoningEffort : opencodeDefaultEffort ?? 'default'
    const opencodeEffortOptions = opencodeVariantOptions === undefined || (opencodeVariantOptions?.length === 0 && !opencodeDefaultEffort)
        ? [] : [
            ...(!opencodeDefaultEffort ? [{ value: 'default', label: t('newSession.model.default') }] : []),
            ...Array.from(new Set([...(opencodeVariantOptions ?? []), ...(opencodeDefaultEffort ? [opencodeDefaultEffort] : [])]))
                .map(value => ({ value, label: formatCodexReasoningEffortLabel(value) }))
        ]
    const opencodeCatalogPending = agent === 'opencode'
        && (Boolean(opencodeSelectedModel) || modelReasoningEffort !== 'default')
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
    const agyGroups = useMemo(() => {
        const groups = new Map<string, { value: string; label: string; variants: Array<{ id: string; effort: string }> }>()
        for (const entry of agyModelsState.availableModels) {
            if (isRemovedAgyModel(entry.modelId)) continue
            const match = entry.modelId.match(/^(.*)-(low|medium|high|xhigh|max)$/)
            const base = match?.[1] ?? entry.modelId
            const group = groups.get(base) ?? { value: base, label: (entry.name ?? base).replace(/\s*\([^)]*\)$/, ''), variants: [] }
            if (match) group.variants.push({ id: entry.modelId, effort: match[2] })
            groups.set(base, group)
        }
        const order = ['low', 'medium', 'high', 'xhigh', 'max']
        return [...groups.values()].map(group => ({ ...group, variants: group.variants.sort((a, b) => order.indexOf(a.effort) - order.indexOf(b.effort)) }))
    }, [agyModelsState.availableModels])
    const agyWire = agyModelPickedByUserRef.current ? agySelectedModel ?? AGY_HIGH_MODEL_ID : AGY_HIGH_MODEL_ID
    const agyBase = agyWire.replace(/-(low|medium|high|xhigh|max)$/, '')
    const agyGroup = agyGroups.find(group => group.value === agyBase)
    const savedAgyEffort = modelPreferences.preferences.find(row => row.agent === 'agy' && row.modelId === agyBase)?.reasoningEffort

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
            || modelPreferences.loading
            || model === 'auto'
        ) {
            return
        }
        if (!selectedCustomModel && !piModelOptions.some((option) => option.value === model)) {
            setModel('auto')
            setEffort('auto')
        }
    }, [agent, model, piModelOptions, piModelsState.error, piModelsState.isLoading, modelPreferences.loading, selectedCustomModel])
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
        const fallback = opencodeModelsState.currentModelId
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
        if (agent !== 'agy' || agyModelPickedByUserRef.current || !savedAgyEffort) return
        const variant = agyGroup?.variants.find(item => item.effort === savedAgyEffort)
        if (variant) { agyModelPickedByUserRef.current = true; setAgySelectedModel(variant.id) }
    }, [agent, agyGroup, savedAgyEffort])

    useEffect(() => {
        if (
            agent !== 'grok'
            || deferredDirectoryExists !== true
            || grokModelsState.isLoading
            || grokModelsState.error
            || modelPreferences.loading
        ) {
            return
        }
        if (
            model !== 'auto'
            && !selectedCustomModel
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
        modelPreferences.loading,
        selectedCustomModel,
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
            && !modelPreferences.loading
            && !selectedCustomModel
            && model !== 'auto'
            && !copilotModelsState.availableModels.some((candidate) => candidate.modelId === model)
        ) {
            setModel('auto')
        }
    }, [
        agent,
        modelPreferences.loading,
        selectedCustomModel,
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
            && !modelPreferences.loading
            && !selectedCustomModel
            && model !== 'auto'
            && !kimiModelsState.availableModels.some((candidate) => candidate.modelId === model)
        ) {
            setModel('auto')
        }
    }, [
        agent,
        modelPreferences.loading,
        selectedCustomModel,
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

    function applyModelChoice(choice: ModelChoice) {
        const speed = modelPreferences.preferences.find(row => row.agent === choice.agent && row.modelId === choice.value)?.speed
        if (choice.agent === 'codex') setServiceTier(speed ?? 'fast')
        pendingCursorSpeed.current = choice.agent === 'cursor' ? { id: choice.value, speed: speed ?? 'standard' } : null
        if (choice.agent === 'codex' || choice.agent === 'opencode') setModelReasoningEffort('default')
        if (choice.agent === 'agy') {
            agyModelPickedByUserRef.current = choice.value !== 'auto'
            const group = agyGroups.find(item => item.value === choice.value)
            const saved = modelPreferences.preferences.find(row => row.agent === 'agy' && row.modelId === choice.value)?.reasoningEffort
            setAgySelectedModel(group?.variants.find(item => item.effort === saved)?.id ?? group?.variants.find(item => item.effort === 'high')?.id ?? group?.variants[0]?.id ?? choice.value)
        } else if (choice.agent === 'opencode') {
            setOpencodeSelectedModel(choice.value === 'auto' ? null : choice.value)
        } else {
            setModel(choice.value)
            if (choice.agent === 'cursor') setCursorSelectedBase('auto')
        }
    }

    // Agent-change effects reset permissions/effort before applying the explicit
    // pair. Otherwise those resets could silently replace a clicked model.
    useEffect(() => {
        const choice = pendingModelChoice.current
        if (choice?.agent === agent) {
            pendingModelChoice.current = null
            applyModelChoice(choice)
        }
    }, [agent])

    const effectiveFilter = agentFilter !== 'all' && !availableAgents.includes(agentFilter) ? 'all' : agentFilter
    const quickModels: Partial<Record<AgentType, readonly { value: string; label: string }[]>> = {
        codex: CODEX_HARDCODED_OPTIONS.map(option => ({
            ...option, label: resolveCodexModel(codexModelsState.models, option.value)?.displayName ?? option.value
        })),
        claude: claudeGlmBranded ? [
            { value: 'auto', label: CLAUDE_GLM_HARDCODED_LABEL },
            { value: CLAUDE_GLM_MODEL_ID, label: CLAUDE_GLM_MODEL_LABEL },
        ] : undefined,
        agy: [
            ...(!agyGroups.some(group => group.value === AGY_HIGH_MODEL_ID.replace(/-high$/, ''))
                ? [{ value: AGY_HIGH_MODEL_ID.replace(/-high$/, ''), label: AGY_HIGH_MODEL_LABEL }] : []),
            ...agyGroups.map(({ value, label }) => ({ value, label }))
        ],
        opencode: OPENCODE_HARDCODED_OPTIONS,
        cursor: [
            { value: CURSOR_GROK_XHIGH_WIRE, label: 'Grok 4.7 Extra High' },
            { value: CURSOR_COMPOSER_STANDARD_WIRE, label: 'Composer 2.5' },
        ],
        minimax: [{ value: 'auto', label: MINIMAX_HARDCODED_LABEL }],
    }
    const manageModelOptions = agent === 'opencode'
        ? [...OPENCODE_HARDCODED_OPTIONS, ...opencodeModelsState.availableModels
            .filter(option => option.modelId !== OPENCODE_HARDCODED_MODEL_ID)
            .map(option => ({ value: option.modelId, label: option.name ?? option.modelId }))]
        : agent === 'cursor'
            ? [...(quickModels.cursor ?? []), ...cursorModelsState.availableModels.map(option => ({ value: option.modelId, label: option.name ?? option.modelId }))]
            : agent === 'agy'
                ? [...(quickModels.agy ?? [])]
                : [...(quickModels[agent] ?? []), ...launchModelOptions.filter(option => agent !== 'codex' || (option.value !== 'auto' && option.value !== 'gpt-6-astra'))]
    for (const preference of modelPreferences.preferences) {
        if (preference.agent === agent && !manageModelOptions.some(option => option.value === preference.modelId)) {
            manageModelOptions.push({ value: preference.modelId, label: preference.modelId })
        }
    }
    const selectedModel = agent === 'agy' ? agyBase
        : agent === 'opencode' ? opencodeSelectedModel ?? OPENCODE_HARDCODED_MODEL_ID
        : agent === 'cursor' ? cursorSpeedOptions?.standard ?? model : model
    const cursorDefaultChoice = model === 'auto' && agent === 'cursor'
        ? cursorQuickPick ?? quickModels.cursor?.find(option => option.value === cursorSpeedOptions?.standard || option.value === cursorEffectiveModel || option.label === nativeDefaultModelName)?.value
        : undefined
    let displayedModel = cursorDefaultChoice ?? selectedModel
    if (agent === 'codex' && model === 'auto') {
        displayedModel = resolveCodexModel(codexModelsState.models, null)?.id ?? 'auto'
    } else if (agent === 'cursor' && selectedModel.endsWith('[fast=false]')) {
        displayedModel = selectedModel.slice(0, -12)
    }
    const modelChoices: ModelChoice[] = availableAgents
        .filter(flavor => effectiveFilter === 'all' || flavor === effectiveFilter)
        .flatMap(flavor => {
            const defaultName = agentAvailability.agents.find(entry => entry.agent === flavor)?.defaultModelName
            const savedForFlavor = modelPreferences.preferences.filter(row => row.agent === flavor)
            const choicesForFlavor = [...(quickModels[flavor] ?? [])].filter(option => !savedForFlavor.some(row => row.modelId === option.value && row.hidden))
            for (const preference of savedForFlavor) {
                if (preference.pinned && !preference.hidden && !choicesForFlavor.some(option => option.value === preference.modelId)) {
                    const known = flavor === agent ? manageModelOptions.find(option => option.value === preference.modelId) : undefined
                    choicesForFlavor.push({ value: preference.modelId, label: known?.label ?? preference.modelId })
                }
            }
            const options = choicesForFlavor.map(option => {
                const alias = savedForFlavor.find(row => row.modelId === option.value)?.alias
                if (alias) return { ...option, label: alias, customLabel: true }
                if (option.value !== 'auto' || flavor === 'opencode' || !defaultName) return option
                // Hide the promotion suffix while preserving the actual release status.
                if (flavor === 'minimax') return { ...option, label: defaultName.replace(/\s+\(Free\)$/i, '') }
                const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]/g, '')
                return { ...option, label: normalize(defaultName).startsWith(normalize(option.label)) ? option.label : defaultName }
            })
            if ((quickModels[flavor] || savedForFlavor.length > 0) && flavor === agent && !options.some(option => option.value === displayedModel) && !savedForFlavor.some(row => row.modelId === displayedModel && row.hidden) && flavor !== 'dsh') {
                const customLabel = savedForFlavor.find(row => row.modelId === displayedModel)?.alias
                options.unshift({ value: displayedModel, customLabel: Boolean(customLabel), label: customLabel ?? (displayedModel === 'auto'
                    ? nativeDefaultModelName ?? t('newSession.model.default')
                    : (agent === 'codex' ? resolveCodexModel(codexModelsState.models, displayedModel)?.displayName : undefined) ?? namedLaunchModelOptions.find(option => option.value === displayedModel)?.label ?? displayedModel) })
            }
            return options.map(option => ({ ...option, agent: flavor }))
        })

    const visibleModelChoices = availableAgents
        .filter(flavor => effectiveFilter === 'all' || flavor === effectiveFilter)
        .flatMap(flavor => {
            const choices = modelChoices.filter(choice => choice.agent === flavor && (effectiveFilter !== 'all' || !modelPreferences.preferences.some(row => row.agent === flavor && row.modelId === choice.value && row.showInAll === false)))
            const pinned = modelPreferences.preferences
                .filter(preference => preference.agent === flavor && preference.pinned)
                .map(preference => choices.find(choice => choice.value === preference.modelId))
                .filter((choice): choice is ModelChoice => choice !== undefined)
            const pinnedIds = new Set(pinned.map(choice => choice.value))
            return [...pinned, ...choices.filter(choice => !pinnedIds.has(choice.value))]
        })

    useEffect(() => {
        if (!initialChoicePending.current || modelPreferences.loading || agentAvailability.isLoading || agentAvailability.error) return
        const first = visibleModelChoices[0]
        if (!first) return
        initialChoicePending.current = false
        if (first.agent === agent) applyModelChoice(first)
        else { pendingModelChoice.current = first; setAgent(first.agent) }
    }, [modelPreferences.loading, modelPreferences.preferences, agentAvailability.isLoading, agentAvailability.error, availableAgents])

    useEffect(() => {
        if (!agentChoicePending.current || agentChoicePending.current !== agent || modelPreferences.loading) return
        const first = visibleModelChoices.find(choice => choice.agent === agent)
        if (!first) return
        agentChoicePending.current = null
        applyModelChoice(first)
    }, [agent, effectiveFilter, modelPreferences.loading, modelPreferences.preferences])

    useEffect(() => {
        const pending = pendingCursorSpeed.current
        if (agent !== 'cursor' || !pending || cursorModelsState.isLoading || (!cursorModelsState.error && !cursorModelsState.availableModels.length && !cursorModelsState.cliModelSkus.length)) return
        const options = getCursorModelSpeedOptions(pending.id, [...cursorModelsState.availableModels, ...cursorModelsState.cliModelSkus])
        if (options) setModel(options[pending.speed])
        pendingCursorSpeed.current = null
    }, [agent, model, cursorModelsState.isLoading, cursorModelsState.availableModels, cursorModelsState.cliModelSkus])

    useEffect(() => { setModelManagerOpen(false) }, [effectiveFilter])
    useEffect(() => {
        if (modelPreferences.loading || !modelPreferences.preferences.some(row => row.agent === agent && row.modelId === displayedModel && row.hidden)) return
        const fallback = visibleModelChoices.find(choice => choice.agent === agent)
        if (fallback) applyModelChoice(fallback)
    }, [agent, displayedModel, modelPreferences.loading, modelPreferences.preferences, visibleModelChoices])

    const handleMachineChange = useCallback((newMachineId: string) => {
        defaultApplied.current = true
        preserveRestoredDraftRef.current = false
        setMachineId(newMachineId)
        setModel(agent === 'codex' ? CODEX_DEFAULT_MODEL_ID : 'auto')
        setCursorSelectedBase('auto')
        setSelectedCodexImportSessionId(null)
        setCodexImportSessions([])
        setCodexImportMachineId(null)
        setSelectedPiImportSessionId(null)
        setPiImportSessions([])
        setPiImportMachineId(null)
        const machine = props.machines.find((candidate) => candidate.id === newMachineId)
        setDirectory(machine
            ? projectPreferences.projects.find(p => p.isDefault && p.machineId === newMachineId)?.path ?? resolveDefaultMachineDirectory(machine, getRecentProjectPaths(sessions, newMachineId), projectPreferences.projects.filter(p => p.machineId === newMachineId && p.hidden).map(p => p.path))
            : '')
    }, [sessions, props.machines, projectPreferences.projects])

    const handleChooseFolderClick = useCallback(() => {
        if (!props.onChooseFolder) {
            return
        }
        saveNewSessionFormDraft({
            agentFilter,
            initialPrompt,
            initialImages,
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
        agentFilter,
        initialPrompt,
        initialImages,
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
        defaultApplied.current = true
        setDirectory(path)
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            defaultApplied.current = true
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        defaultApplied.current = true
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

    function buildLaunchInput(): SessionEditorState['input'] {
        const resolvedModel = agent === 'opencode'
            ? (!opencodeSelectedModel || opencodeSelectedModel === 'auto' ? OPENCODE_HARDCODED_MODEL_ID : opencodeSelectedModel)
            : agent === 'agy'
                ? (agyModelPickedByUserRef.current ? agySelectedModel ?? AGY_HIGH_MODEL_ID : AGY_HIGH_MODEL_ID)
                : agent === 'cursor'
                    ? (model === 'auto' || !model ? undefined : model)
                    : (model !== 'auto' ? model : undefined)
        // GLM has no effort levels: a branded claude never passes one,
        // even if a remembered value was restored before the flag arrived.
        const resolvedEffort = ((agent === 'claude' && !claudeGlmBranded) || agent === 'grok' || agent === 'pi') && effort !== 'auto'
            ? effort
            : undefined
        const resolvedModelReasoningEffort = agent === 'opencode'
            ? (modelReasoningEffort !== 'default' ? modelReasoningEffort : opencodeDefaultEffort)
            : agent === 'codex' && effectiveCodexEffort !== 'default'
                ? effectiveCodexEffort
                : undefined
        const resolvedServiceTier = agent === 'codex' && showCodexFastMode
            ? serviceTier
            : undefined
        const resolvedCollaborationMode = agent === 'codex' && collaborationMode !== 'default'
            ? collaborationMode
            : undefined

        return {
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
        }
    }

    async function handleCreate() {
        if (!machineId || !trimmedDirectory || createInFlightRef.current) return

        if (props.onStartChat && (initialPrompt.trim() || initialImages.length) && !continueFrom && !selectedCodexImportSession && !selectedPiImportSession) {
            props.onStartChat(buildCompositionState())
            return
        }

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


            const { model: resolvedModel, modelReasoningEffort: resolvedModelReasoningEffort, serviceTier: resolvedServiceTier, collaborationMode: resolvedCollaborationMode } = buildLaunchInput()

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
                if (targetGroupId) {
                    try {
                        await props.api.addGroupChat(targetGroupId, sessionId)
                    } catch (error) {
                        addToast({ title: t('groups.addFailed'), body: error instanceof Error ? error.message : '', sessionId, url: `/sessions/${sessionId}` })
                    }
                }
                props.onSuccess(sessionId, true)
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
                clearNewSessionFormDraft()
                setLastUsedMachineId(machineId)
                await finishImportedSession(reopened.sessionId)
                return
            }

            const result = await spawnSession({ ...buildLaunchInput(), machineId, groupId: targetGroupId })


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
                clearNewSessionFormDraft()
                setLastUsedMachineId(machineId)
                props.onSuccess(result.sessionId, true)
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
        && !readingImages
        && (!initialImages.length || INITIAL_IMAGE_AGENTS.includes(agent))
        && (!createGroup || (groupName.trim().length > 0 && groupName.trim().length <= 120))
    )

    function buildEditorState(): SessionEditorState {
        const input = buildLaunchInput()
        const codexModel = agent === 'codex' ? resolveCodexModel(codexModelsState.models, input.model) : null
        const selectedChoice = modelChoices.find(choice => choice.agent === agent && choice.value === displayedModel)
        const modelName = selectedChoice?.label ?? (agent === 'claude' && claudeGlmBranded ? (model === 'auto' ? CLAUDE_GLM_HARDCODED_LABEL : CLAUDE_GLM_MODEL_LABEL) : undefined)
            ?? (agent === 'agy' ? AGY_HIGH_MODEL_LABEL : undefined)
            ?? (agent === 'opencode' ? OPENCODE_HARDCODED_OPTIONS.find(option => option.value === (opencodeSelectedModel ?? 'auto'))?.label : undefined)
            ?? (agent === 'minimax' && model === 'auto' ? MINIMAX_HARDCODED_LABEL : undefined)
            ?? namedLaunchModelOptions.find(option => option.value === (input.model ?? 'auto'))?.label
            ?? input.model ?? nativeDefaultModelName ?? t('newSession.model.default')
        return {
            input, canCreate,
            modelLabel: modelChipText({
                name: agent === 'opencode' || agent === 'cursor' ? modelChoiceLabel(modelName) : modelName,
                wireId: input.model ?? codexModel?.id, flavor: agent,
                modelReasoningEffort: agent === 'codex' ? undefined : input.modelReasoningEffort,
                effort: input.effort, fast: input.serviceTier === 'fast',
            }),
            draft: { initialPrompt, initialImages, agent, model: agent === 'agy' ? (agySelectedModel ?? 'auto') : agent === 'opencode' ? (opencodeSelectedModel ?? 'auto') : model,
                cursorSelectedBase, machineId, effort, modelReasoningEffort, serviceTier, collaborationMode, copilotAgentMode,
                yoloMode, nativePermissionMode, grokPermissionMode, sessionType, worktreeName, agentFilter }
        }
    }

    function buildCompositionState() {
        const state = buildEditorState()
        state.draft.groupId = props.groupId ?? createdGroup?.id
        if (!state.draft.groupId && createGroup) {
            const name = groupName.trim()
            if (groupRequestRef.current?.name !== name) groupRequestRef.current = { name, requestId: crypto.randomUUID() }
            state.draft.groupCreation = groupRequestRef.current
        }
        return state
    }

    function handleAddChat() {
        props.onAddChat?.(buildCompositionState())
    }

    const editorStateJson = props.editor ? JSON.stringify(buildEditorState()) : null
    const editorOnChange = props.editor?.onChange
    useEffect(() => {
        if (editorStateJson) editorOnChange?.(JSON.parse(editorStateJson) as SessionEditorState)
    }, [editorStateJson, editorOnChange])

    return (
        <div className="flex flex-col divide-y divide-[var(--app-divider)] [&>div]:pr-[10px] lg:[&>div]:pr-3">
            {continueFrom ? (
                <div className="px-3 py-2 text-sm text-[var(--app-hint)]">
                    {t('newSession.continue.description', { title: getSessionTitle(continueFrom) })}
                </div>
            ) : null}
            {!props.editor ? <div className="px-3 py-3 text-sm">
                {props.groupId || createdGroup ? <p className="text-[var(--app-hint)]">{t('groups.newChatIn', { name: props.groupName ?? createdGroup?.name ?? '' })}</p> : <>
                    <div className="flex flex-col gap-1.5 text-xs text-[var(--app-hint)]">
                        <label htmlFor="new-group-name">{t('groups.name')}</label>
                        <input id="new-group-name" aria-describedby="new-group-description" value={groupName} maxLength={120} disabled={isFormDisabled} onChange={event => setGroupName(event.target.value)} placeholder={t('groups.namePlaceholder')}
                            className="min-h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)]" />
                        <p id="new-group-description">{t('batch.groupHint')}</p>
                    </div>
                </>}
                {props.groupDefaultsUnavailable || (props.initialAgent && !agentAvailability.isLoading && !agentAvailability.error && !availableAgents.includes(props.initialAgent)) ? <p role="status" className="mt-2 text-xs text-[var(--app-hint)]">{t('groups.defaultsUnavailable')}</p> : null}
            </div> : null}
            {/* Fork: a single-machine setup needs no picker; it would only be
                one more thing to scroll past on the phone. */}
            {!props.editor && props.machines.length > 1 ? (
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
            {!props.editor ? <DirectorySection
                directory={directory}
                aliases={Object.fromEntries(projectPreferences.projects.filter(p => p.machineId === machineId && p.alias).map(p => [p.path, p.alias!]))}
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
            /> : null}
            {props.editor && directoryStatusMessage ? <p role="status" className="px-3 py-2 text-xs text-[var(--app-hint)]">{directoryStatusMessage}</p> : null}
            {props.editor && props.initialAgent && !agentAvailability.isLoading && !agentAvailability.error && !availableAgents.includes(props.initialAgent) ? <p role="status" className="px-3 py-2 text-xs text-[var(--app-hint)]">{t('groups.defaultsUnavailable')}</p> : null}
            {/* Fork: worktree launches are never used here, so the type
                selector is not rendered — sessions always launch in place
                (`sessionType` stays 'simple'; the draft restore clamps it). */}
            <AgentSelector
                agent={agent}
                filter={effectiveFilter}
                showAllAgents={!isNarrow}
                allowClear={isNarrow}
                onFilterChange={value => {
                    initialChoicePending.current = false
                    setAgentFilter(value)
                    if (value !== 'all' && value !== agent) { agentChoicePending.current = value; handleAgentChange(value) }
                }}
                agents={availableAgents}
                isDisabled={isFormDisabled || agentAvailability.isLoading || Boolean(agentAvailability.error)}
                onAgentChange={value => { setAgentFilter(value); handleAgentChange(value) }}
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
            {!props.editor && agent === 'pi' ? (
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
            <ModelChoices
                options={visibleModelChoices}
                showAgent={effectiveFilter === 'all'}
                agent={agent}
                model={displayedModel}
                isDisabled={isFormDisabled || !machineId || agentAvailability.isLoading || Boolean(agentAvailability.error)}
                onSelect={choice => {
                    initialChoicePending.current = false
                    agentChoicePending.current = null
                    if (choice.agent === agent) applyModelChoice(choice)
                    else {
                        pendingModelChoice.current = choice
                        handleAgentChange(choice.agent)
                    }
                }}
            />
            {!quickModels[agent] && agent !== 'dsh' ? <ModelSelector
                agent={agent} model={model} options={namedLaunchModelOptions}
                isDisabled={isFormDisabled || Boolean(agent === 'grok' ? grokModelsState.error
                    : agent === 'copilot' ? copilotModelsState.error
                    : agent === 'kimi' ? kimiModelsState.error
                    : agent === 'pi' ? piModelsState.error : null)}
                isLoading={(agent === 'grok' && grokModelsState.isLoading)
                    || (agent === 'copilot' && copilotModelsState.isLoading)
                    || (agent === 'kimi' && kimiModelsState.isLoading)
                    || (agent === 'pi' && piModelsState.isLoading)}
                error={agent === 'grok' ? grokModelsState.error
                    : agent === 'copilot' ? copilotModelsState.error
                    : agent === 'kimi' ? kimiModelsState.error
                    : agent === 'pi' ? piModelsState.error : null}
                onModelChange={setModel}
            /> : null}
            {agent === 'codex' && codexModelsState.error ? <p role="alert" className="px-3 py-2 text-sm text-red-600">{t('newSession.model.loadFailed')}: {codexModelsState.error}</p> : null}
            {agent === 'agy' && agyGroup?.variants.length ? <section className="flex min-w-0 flex-wrap items-center gap-2 p-2 sm:gap-3 sm:p-3" role="group" aria-label={t('newSession.effort')}>
                <ChoiceLabel kind="effort" />
                {agyGroup.variants.map(variant => <button key={variant.id} type="button" aria-pressed={agyWire === variant.id}
                    onClick={() => { agyModelPickedByUserRef.current = true; setAgySelectedModel(variant.id) }}
                    className={`rounded-full border px-2.5 py-1 text-xs ${agyWire === variant.id ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]' : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'}`}>
                    {formatCodexReasoningEffortLabel(variant.effort)}
                </button>)}
            </section> : null}
            {showPiLaunchConfig && !(agent === 'claude' && claudeGlmBranded) ? (
                <EffortField
                    agent={agent}
                    effort={effort}
                    onEffortChange={setEffort}
                    reasoningEffort={agent === 'codex' ? effectiveCodexEffort : agent === 'opencode' ? effectiveOpencodeEffort : modelReasoningEffort}
                    onReasoningEffortChange={setModelReasoningEffort}
                    codexOptions={agent === 'codex' ? (codexSupportedReasoningEfforts ?? ['low', 'medium', 'high', 'xhigh']).map((value) => ({
                        value,
                        label: formatCodexReasoningEffortLabel(value)
                    })) : undefined}
                    opencodeOptions={agent === 'opencode' ? opencodeEffortOptions : undefined}
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

            {!props.editor && modelManagerOpen && effectiveFilter !== 'all' && effectiveFilter === agent && showPiLaunchConfig ? <ModelManager
                agent={agent}
                options={agent === 'opencode' ? manageModelOptions.map(option => ({ ...option, label: modelChoiceLabel(option.label) })) : manageModelOptions}
                shown={visibleModelChoices.filter(choice => choice.agent === agent).map(choice => agent === 'opencode' ? { ...choice, label: modelChoiceLabel(choice.label) } : choice)}
                supportsSpeed={agent === 'codex' ? id => codexModelAdvertisesFastTier(id === 'auto' ? null : id, codexModelsState.models) : agent === 'cursor' ? id => Boolean(getCursorModelSpeedOptions(id, [...cursorModelsState.availableModels, ...cursorModelsState.cliModelSkus])) : undefined}
                getEffortOptions={agent === 'codex' ? id => getCodexModelReasoningEfforts(codexModelsState.models, id) ?? ['low', 'medium', 'high', 'xhigh'] : agent === 'opencode' ? id => opencodeVariantsState.variants?.[id] ?? [] : agent === 'agy' ? id => agyGroups.find(group => group.value === id)?.variants.map(item => item.effort) ?? [] : undefined}
                preferences={modelPreferences.preferences} error={modelPreferences.error} onSave={async preference => {
                    await modelPreferences.save(preference)
                    if (preference.agent === agent && preference.modelId === displayedModel && preference.speed) {
                        if (agent === 'codex') setServiceTier(preference.speed)
                        if (agent === 'cursor' && cursorSpeedOptions) setModel(cursorSpeedOptions[preference.speed])
                    }
                    if ((preference.agent === 'codex' && preference.modelId === model) || (preference.agent === 'opencode' && preference.modelId === opencodeEffectiveModelId)) setModelReasoningEffort('default')
                    if (preference.agent === 'agy' && preference.modelId === agyBase && preference.reasoningEffort) {
                        const variant = agyGroup?.variants.find(item => item.effort === preference.reasoningEffort)
                        if (variant) { agyModelPickedByUserRef.current = true; setAgySelectedModel(variant.id) }
                    }
                }} onReorder={modelPreferences.reorder}
                onRemove={id => {
                    if (id === displayedModel) {
                        const fallback = visibleModelChoices.find(choice => choice.agent === agent && choice.value !== id)
                        if (fallback) applyModelChoice(fallback)
                    }
                }} /> : null}
            {props.onStartChat && !props.editor && !continueFrom && !selectedCodexImportSession && !selectedPiImportSession ? <div className="px-3 py-3">
                <InitialPrompt label={t('newSession.initialPrompt')} value={initialPrompt} onChange={setInitialPrompt}
                    images={initialImages} onImagesChange={setInitialImages} onReadingChange={setReadingImages}
                    agent={agent} disabled={isFormDisabled} placeholder={t('batch.promptPlaceholder')} />
            </div> : null}
            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            {!props.editor && projectManagerOpen ? projectPreferences.loading ? <p role="status" className="px-3 py-2 text-xs text-[var(--app-hint)]">{t('newSession.projects.loading')}</p> : projectPreferences.error ? <p role="alert" className="px-3 py-2 text-xs text-red-600">{t('newSession.projects.loadError')} <button type="button" className="underline" onClick={() => void projectPreferences.retry()}>{t('button.retry')}</button></p> : <ProjectManager machineId={machineId} projects={projectPreferences.projects} knownPaths={[...workPaths, ...filteredRecentPaths]} save={projectPreferences.save} /> : null}
            {!props.editor ? <ActionButtons
                isPending={isCreating || isPending || isImportingCodexSession || isImportingPiSession}
                canCreate={canCreate}
                isDisabled={isFormDisabled || readingImages}
                createLabel={createLabel}
                onCancel={props.onCancel}
                onCreate={handleCreate}
                onAddChat={props.onAddChat && !selectedCodexImportSession && !selectedPiImportSession ? handleAddChat : undefined}
                onManageProjects={() => setProjectManagerOpen(open => !open)}
                manageProjectsOpen={projectManagerOpen}
                onManageModels={effectiveFilter !== 'all' && effectiveFilter === agent && agent !== 'dsh' && showPiLaunchConfig ? () => setModelManagerOpen(open => !open) : undefined}
                manageModelsOpen={modelManagerOpen}
            /> : null}
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
