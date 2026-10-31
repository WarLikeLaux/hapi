import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine, PiModelSummary } from '@/types/api'
import { setClaudeGlmBranded } from '@/lib/claudeGlmBranding'
import { ImagePreviewProvider } from '@/components/ImagePreview'
import { saveNewSessionFormDraft } from './newSessionFormDraft'
import {
    loadPreferredLaunchSettings,
    savePreferredAgent,
    savePreferredLaunchSettings,
    savePreferredYoloMode
} from './preferences'

const mocks = vi.hoisted(() => ({
    popularModels: [] as Array<{ agent: 'codex' | 'cursor' | 'opencode'; model: string; sessionCount: number; lastUsedAt: number }>,
    narrowViewport: false,
    useRealCatalogHooks: false,
    spawnSession: vi.fn(),
    sendMessage: vi.fn(),
    onSuccess: vi.fn(),
    notification: vi.fn(),
    checkPathsExists: vi.fn(),
    availableAgents: [
        'agy', 'claude', 'codex', 'dsh', 'copilot', 'cursor', 'grok', 'kimi', 'opencode', 'pi'
    ].map((agent) => ({ agent, available: true, defaultModelName: undefined as string | undefined })),
    codexDefaultModelId: 'gpt-6.1-sol',
    codexTerraName: 'GPT-6.1 Terra',
    codexModelsLoading: false,
    codexModelsError: null as string | null,
    agyModelsLoading: false,
    agyModels: [{ modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' }],
    directoryExists: undefined as boolean | undefined,
    copilotModels: [] as Array<{ modelId: string; name?: string }>,
    copilotModelsLoading: false,
    kimiModels: [] as Array<{ modelId: string; name?: string; provider?: string }>,
    kimiModelsLoading: false,
    kimiModelsError: null as string | null,
    kimiCurrentModelId: null as string | null,
    grokModels: [] as Array<{ modelId: string; name?: string }>,
    grokCurrentModelId: null as string | null,
    opencodeModels: [] as Array<{ modelId: string; name?: string }>,
    opencodeCurrentModelId: null as string | null,
    opencodeModelsLoading: false,
    opencodeModelsEnabled: false,
    opencodeVariants: null as Record<string, string[]> | null,
    opencodeVariantsLoading: false,
    opencodeVariantsEnabled: false,
    piDialogSelection: ['pi-native-1'] as string[],
    cursorModels: [] as Array<{ modelId: string; name?: string }>,
    cursorSkus: [] as Array<{ modelId: string; name?: string }>,
    cursorCurrentModelId: null as string | null,
    cursorModelsLoading: false,
    cursorModelsError: null as string | null,
    piModels: [] as PiModelSummary[],
    piModelsLoading: false,
    piModelsError: null as string | null,
    piCurrentModelId: null as string | null,
    nextModelValue: 'gpt-5.6-terra',
    refetchSessions: vi.fn(),
    addToast: vi.fn(),
    projectPreferences: [] as import('@/api/client').ProjectPreference[],
    projectsLoading: false,
    modelPreferences: [] as Array<{ agent: string; modelId: string; pinned: boolean; alias: string | null; hidden?: boolean; reasoningEffort?: string | null; speed?: 'fast' | 'standard' | null; showInAll?: boolean }>,
    saveModelPreference: vi.fn(),
    reorderModelPreferences: vi.fn()
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => {
        const modelManagerLabels: Record<string, string> = {
            'newSession.models.manage': 'Manage models',
            'newSession.models.hide': 'Hide models',
            'newSession.models.search': 'Search models',
            'newSession.models.aliasFor': 'Alias for {model}',
            'newSession.models.effortFor': 'Effort for {model}',
            'newSession.models.speedFor': 'Speed for {model}',
            'newSession.models.showInAllFor': 'Show {model} in All agents',
            'newSession.models.pin': 'Pin {model}',
            'newSession.models.unpin': 'Unpin {model}',
            'newSession.models.addNamed': 'Add {model}',
            'newSession.models.remove': 'Remove {model}',
            'newSession.models.moveUp': 'Move {model} up',
            'newSession.models.moveDown': 'Move {model} down',
            'newSession.models.newId': 'Model ID',
            'newSession.models.choose': 'Choose a model',
            'newSession.models.custom': 'Enter model ID…',
            'newSession.models.add': 'Add'
        }
        return (modelManagerLabels[key] ?? key).replace('{model}', params?.model ?? '')
    } })
}))
vi.mock('@/hooks/useProjectPreferences', () => ({ useProjectPreferences: () => ({ projects: mocks.projectPreferences, loading: mocks.projectsLoading, error: null, save: vi.fn() }) }))
vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}))
vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: mocks.notification } })
}))
vi.mock('@/hooks/mutations/useSpawnSession', () => ({
    useSpawnSession: () => ({
        spawnSession: mocks.spawnSession,
        isPending: false,
        error: null
    })
}))
vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({ sessions: [], refetch: mocks.refetchSessions })
}))
vi.mock('@/hooks/useLastUsedMachine', () => ({
    useLastUsedMachine: () => ({
        getLastUsedMachineId: () => null,
        setLastUsedMachineId: vi.fn()
    })
}))
vi.mock('@/hooks/useMachinePathsExists', () => ({
    useMachinePathsExists: () => ({
        pathExistence: { 'C:\\repo': mocks.directoryExists },
        outsideWorkspaceRoots: new Set<string>(),
        checkPathsExists: mocks.checkPathsExists
    })
}))
vi.mock('@/hooks/queries/useAgentAvailability', () => ({
    useAgentAvailability: () => ({
        agents: mocks.availableAgents,
        isLoading: false,
        error: null,
        upgradeRequired: false,
        refetch: vi.fn()
    })
}))
vi.mock('@/hooks/useDirectorySuggestions', () => ({
    useDirectorySuggestions: () => []
}))
vi.mock('@/hooks/useActiveSuggestions', () => ({
    useActiveSuggestions: () => [[], -1, vi.fn(), vi.fn(), vi.fn()]
}))
vi.mock('@/hooks/useNarrowViewport', () => ({ useNarrowViewport: () => mocks.narrowViewport }))
vi.mock('@/hooks/queries/usePopularModels', () => ({ usePopularModels: () => ({ models: mocks.popularModels, isLoading: false }) }))
vi.mock('@/hooks/queries/useCodexModels', () => ({
    useCodexModels: () => ({
        models: [
            {
                id: 'gpt-6.1-terra',
                displayName: mocks.codexTerraName,
                isDefault: false,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
                serviceTiers: ['priority', 'fast']
            },
            {
                id: 'gpt-6-sol',
                displayName: 'GPT-6 Sol',
                isDefault: false,
                defaultReasoningEffort: 'medium',
                supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
                serviceTiers: ['priority', 'fast']
            },
            {
                id: 'gpt-6.1-sol',
                displayName: 'GPT-6.1 Sol',
                isDefault: true,
                defaultReasoningEffort: 'high',
                supportedReasoningEfforts: ['low', 'high', 'xhigh'],
                serviceTiers: ['priority', 'fast']
            },
            {
                id: 'gpt-6-luna',
                defaultReasoningEffort: 'medium',
                displayName: 'GPT-6 Luna',
                isDefault: false,
                supportedReasoningEfforts: ['low', 'high', 'max']
            },
            {
                id: 'gpt-5.6-sol',
                displayName: 'GPT-5.6 Sol',
                isDefault: false,
                supportedReasoningEfforts: ['low', 'high', 'xhigh']
            },
            {
                id: 'gpt-5.6-terra',
                displayName: 'GPT-5.6 Terra',
                isDefault: false,
                supportedReasoningEfforts: ['low', 'high', 'max']
            }
        ].map(model => ({ ...model, isDefault: model.id === mocks.codexDefaultModelId })),
        isLoading: mocks.codexModelsLoading,
        error: mocks.codexModelsError
    })
}))
vi.mock('@/hooks/queries/useAgyModels', () => ({
    useAgyModels: () => ({
        availableModels: mocks.agyModels,
        currentModelId: null,
        isLoading: mocks.agyModelsLoading,
        error: null,
        refetch: vi.fn()
    })
}))
vi.mock('@/hooks/queries/useCursorModelsForMachine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/queries/useCursorModelsForMachine')>()
    return {
        useCursorModelsForMachine: (args: Parameters<typeof actual.useCursorModelsForMachine>[0]) => mocks.useRealCatalogHooks ? actual.useCursorModelsForMachine(args) : ({
            availableModels: mocks.cursorModels,
            cliModelSkus: mocks.cursorSkus,
            currentModelId: mocks.cursorCurrentModelId,
            isLoading: mocks.cursorModelsLoading,
            error: mocks.cursorModelsError,
            refetch: vi.fn()
        })
    }
})
vi.mock('@/hooks/queries/useOpencodeModelsForCwd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/queries/useOpencodeModelsForCwd')>()
    return {
        useOpencodeModelsForCwd: (args: Parameters<typeof actual.useOpencodeModelsForCwd>[0]) => {
            mocks.opencodeModelsEnabled = Boolean(args.enabled)
            return mocks.useRealCatalogHooks ? actual.useOpencodeModelsForCwd(args) : ({
            availableModels: mocks.opencodeModels,
            currentModelId: mocks.opencodeCurrentModelId,
            isLoading: mocks.opencodeModelsLoading,
            error: null,
            refetch: vi.fn()
            })
        }
    }
})
vi.mock('@/hooks/queries/useOpencodeModelVariants', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/queries/useOpencodeModelVariants')>()
    return {
        useOpencodeModelVariants: (args: Parameters<typeof actual.useOpencodeModelVariants>[0]) => {
            if (mocks.useRealCatalogHooks) return actual.useOpencodeModelVariants(args)
            mocks.opencodeVariantsEnabled = Boolean(args.enabled)
            return {
                variants: mocks.opencodeVariants,
                isLoading: mocks.opencodeVariantsLoading,
                error: null
            }
        }
    }
})
vi.mock('@/hooks/queries/useGrokModelsForCwd', () => ({
    useGrokModelsForCwd: () => ({
        availableModels: mocks.grokModels,
        currentModelId: mocks.grokCurrentModelId,
        autoPermissionModeSupported: null,
        isLoading: false,
        error: null
    })
}))
vi.mock('@/hooks/queries/useCopilotModelsForCwd', () => ({
    useCopilotModelsForCwd: () => ({
        availableModels: mocks.copilotModels,
        currentModelId: null,
        isLoading: mocks.copilotModelsLoading,
        error: null
    })
}))
vi.mock('@/hooks/queries/useKimiModelsForCwd', () => ({
    useKimiModelsForCwd: () => ({
        availableModels: mocks.kimiModels,
        currentModelId: mocks.kimiCurrentModelId,
        isLoading: mocks.kimiModelsLoading,
        error: mocks.kimiModelsError
    })
}))
vi.mock('@/hooks/queries/usePiModelsForMachine', () => ({
    usePiModelsForMachine: () => ({
        availableModels: mocks.piModels,
        currentModelId: mocks.piCurrentModelId,
        isLoading: mocks.piModelsLoading,
        error: mocks.piModelsError
    })
}))
vi.mock('../../utils/formatRunnerSpawnError', () => ({
    formatRunnerSpawnError: () => null
}))
vi.mock('@/components/CodexSessionSyncDialog', () => ({
    CodexSessionSyncDialog: () => null
}))
vi.mock('@/components/PiSessionImportDialog', () => ({
    PiSessionImportDialog: (props: { isOpen: boolean; sessions: Array<{ id: string }>; onClose: () => void; onConfirm: (ids: string[]) => Promise<void> }) => props.isOpen ? (
        <>
            <div data-testid="pi-session-ids">{props.sessions.map((session) => session.id).join(',')}</div>
            <button type="button" data-testid="close-pi-history" onClick={props.onClose}>close pi history</button>
            <button type="button" data-testid="select-pi-history" disabled={props.sessions.length === 0} onClick={() => void props.onConfirm(mocks.piDialogSelection)}>
                select pi history
            </button>
        </>
    ) : null
}))
vi.mock('./DirectorySection', () => ({ DirectorySection: (props: { directory: string; onDirectoryChange: (v: string) => void }) => (
    <input aria-label="directory-test" value={props.directory} onChange={e => props.onDirectoryChange(e.target.value)} />
) }))
vi.mock('@/hooks/useSessionContextHubSync', () => ({
    useSessionContextHubSync: () => ({
        ready: true,
        canPersist: false,
        workAliases: [],
        sessionOverrides: {},
        projectOverrides: {},
        persist: () => undefined,
    })
}))
vi.mock('@/hooks/useSessionContextFilter', () => ({
    useSessionContextFilter: () => ({
        workAliases: [],
        projectOverrides: {},
    })
}))
vi.mock('./MachineSelector', () => ({
    MachineSelector: (props: { machines: Machine[]; machineId: string | null; isDisabled: boolean; onChange: (machineId: string) => void }) => (
        <select
            aria-label="machine-selector"
            value={props.machineId ?? ''}
            disabled={props.isDisabled}
            onChange={(event) => props.onChange(event.target.value)}
        >
            {props.machines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id}</option>)}
        </select>
    )
}))
vi.mock('./SessionTypeSelector', () => ({ SessionTypeSelector: () => null }))
vi.mock('./CopilotAgentModeSelector', () => ({ CopilotAgentModeSelector: () => null }))
vi.mock('./OpencodeModelSelector', () => ({
    OpencodeModelSelector: (props: { selectedModel: string | null | undefined; onModelChange: (model: string | null) => void; onLoadModels?: () => void }) => (
        <>
            {props.onLoadModels ? <button type="button" onClick={props.onLoadModels}>newSession.model.loadOptions</button> : null}
            <button type="button" data-testid="opencode-model-default" onClick={() => props.onModelChange(null)}>default</button>
            <button type="button" data-testid="opencode-model-pick" onClick={() => props.onModelChange('provider/model')}>pick</button>
            <div data-testid="opencode-model">{props.selectedModel ?? 'default'}</div>
        </>
    )
}))
vi.mock('./AgyModelSelector', () => ({
    AgyModelSelector: (props: { selectedModel: string | null; onModelChange: (model: string | null) => void; children?: ReactNode }) => (
        <>
            <button type="button" data-testid="agy-model" onClick={() => props.onModelChange('gemini-3.6-flash-low')}>
                {props.selectedModel ?? 'auto'}
            </button>
            {props.children}
        </>
    )
}))
vi.mock('./EffortField', () => ({
    EffortField: (props: { agent: string; effort: string; reasoningEffort: string; codexOptions?: Array<{ value: string; label: string }>; opencodeOptions?: Array<{ value: string; label: string }>; opencodeVariantOptions?: string[] | null; onReasoningEffortChange: (v: string) => void }) => (
        props.agent === 'codex' ? <div role="group" aria-label="newSession.effort">
            {props.codexOptions?.map((option) => <button key={option.value} type="button" aria-pressed={props.reasoningEffort === option.value} onClick={() => props.onReasoningEffortChange(option.value)}>{option.label}</button>)}
        </div> : <>
            <div data-testid="launch-effort">{props.effort}</div>
            <div data-testid="opencode-variants">{props.opencodeVariantOptions?.join(',') ?? 'static'}</div>
            {props.agent === 'opencode' ? <div role="group" aria-label="newSession.effort">
                {props.opencodeOptions?.map(option => <button key={option.value} type="button" aria-pressed={props.reasoningEffort === option.value} onClick={() => props.onReasoningEffortChange(option.value)}>{option.label}</button>)}
            </div> : null}
            <button type="button" data-testid="reasoning" onClick={() => props.onReasoningEffortChange('high')}>
                {props.reasoningEffort}
            </button>
        </>
    )
}))
vi.mock('./ModelSelector', () => ({
    ModelSelector: (props: {
        model: string
        options?: Array<{ value: string; label: string }>
        onModelChange: (model: string) => void
        children?: ReactNode
    }) => (
        <>
            <button type="button" data-testid="model" onClick={() => props.onModelChange(mocks.nextModelValue)}>
                {props.model}
            </button>
            <div data-testid="model-options">{props.options?.map((option) => option.label).join(',')}</div>
            {props.children}
        </>
    )
}))
vi.mock('./ActionButtons', () => ({
    ActionButtons: (props: { onCreate: () => void; onAddChat?: () => void; onChooseFolder?: () => void; onManageModels?: () => void; manageModelsOpen?: boolean; canCreate: boolean; isDisabled: boolean }) => (
        <>
            {props.onAddChat ? <button type="button" disabled={props.isDisabled} onClick={props.onAddChat}>batch.addAnother</button> : null}
            {props.onManageModels ? <button type="button" onClick={props.onManageModels}>{props.manageModelsOpen ? 'Hide models' : 'Manage models'}</button> : null}
            <button type="button" data-testid="create" disabled={!props.canCreate} onClick={props.onCreate}>create</button>
            {props.onChooseFolder ? <button type="button" data-testid="browse" onClick={props.onChooseFolder}>browse</button> : null}
        </>
    )
}))

import { NewSession } from './index'
import { SessionComposer } from './SessionComposer'

const machine = { id: 'machine-1' } as Machine
const api = {
    sendMessage: mocks.sendMessage,
    getModelPreferences: async () => ({ preferences: mocks.modelPreferences }),
    saveModelPreference: mocks.saveModelPreference,
    reorderModelPreferences: mocks.reorderModelPreferences
} as unknown as ApiClient

describe('NewSession launch preferences', () => {
    beforeEach(() => {
        mocks.projectPreferences = []
        mocks.projectsLoading = false
        mocks.narrowViewport = false
        mocks.popularModels = []
        mocks.codexModelsError = null
        mocks.codexTerraName = 'GPT-6.1 Terra'
        mocks.codexDefaultModelId = 'gpt-6.1-sol'
        mocks.cursorModelsError = null
        mocks.cursorCurrentModelId = null
        mocks.useRealCatalogHooks = false
        localStorage.clear()
        sessionStorage.clear()
        mocks.spawnSession.mockReset()
        mocks.sendMessage.mockReset()
        mocks.sendMessage.mockResolvedValue(undefined)
        mocks.onSuccess.mockReset()
        mocks.notification.mockReset()
        mocks.checkPathsExists.mockReset()
        mocks.checkPathsExists.mockImplementation(async () => ({
            exists: { 'C:\\repo': mocks.directoryExists }
        }))
        mocks.availableAgents.splice(
            0,
            mocks.availableAgents.length,
            ...['agy', 'claude', 'codex', 'dsh', 'copilot', 'cursor', 'grok', 'kimi', 'opencode', 'pi']
                .map((agent) => ({ agent, available: true, defaultModelName: undefined }))
        )
        mocks.codexModelsLoading = false
        mocks.agyModelsLoading = false
        mocks.agyModels = [{ modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' }]
        mocks.directoryExists = true
        mocks.copilotModels = []
        mocks.copilotModelsLoading = false
        mocks.kimiModels = []
        mocks.kimiModelsLoading = false
        mocks.kimiModelsError = null
        mocks.kimiCurrentModelId = null
        mocks.grokModels = []
        mocks.grokCurrentModelId = null
        mocks.piCurrentModelId = null
        mocks.opencodeModels = [{ modelId: 'provider/current', name: 'Current' }]
        mocks.opencodeCurrentModelId = 'provider/current'
        mocks.opencodeModelsLoading = false
        mocks.opencodeModelsEnabled = false
        mocks.opencodeVariants = null
        mocks.opencodeVariantsLoading = false
        mocks.opencodeVariantsEnabled = false
        mocks.piDialogSelection = ['pi-native-1']
        mocks.piModels = []
        mocks.piModelsLoading = false
        mocks.piModelsError = null
        mocks.nextModelValue = 'gpt-5.6-terra'
        mocks.refetchSessions.mockReset()
        mocks.refetchSessions.mockResolvedValue(undefined)
        mocks.addToast.mockReset()
        mocks.modelPreferences = []
        mocks.saveModelPreference.mockReset()
        mocks.saveModelPreference.mockImplementation(async preference => {
            mocks.modelPreferences = mocks.modelPreferences.filter(row => row.agent !== preference.agent || row.modelId !== preference.modelId)
            if (preference.pinned || preference.alias || preference.hidden || preference.reasoningEffort || preference.speed || preference.showInAll === false) mocks.modelPreferences.push(preference)
            return { preference }
        })
        mocks.reorderModelPreferences.mockReset()
        mocks.reorderModelPreferences.mockImplementation(async (agent, ids: string[]) => {
            const rows = ids.map(modelId => ({ ...(mocks.modelPreferences.find(row => row.agent === agent && row.modelId === modelId) ?? { agent, modelId, alias: null }), pinned: true, hidden: false }))
            mocks.modelPreferences = [...rows, ...mocks.modelPreferences.filter(row => row.agent !== agent || !ids.includes(row.modelId))]
            return { preferences: mocks.modelPreferences }
        })
        savePreferredAgent('codex')
    })

    async function renderComposer(launchSession: ApiClient['launchSession'], extra: Partial<Parameters<typeof SessionComposer>[0]> = {}) {
        Element.prototype.scrollIntoView = vi.fn()
        URL.createObjectURL = vi.fn(() => 'blob:initial-image')
        URL.revokeObjectURL = vi.fn()
        const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
        const createGroup = vi.fn(async () => ({ group: { id: 'new-group', name: 'Comparison' } }))
        const composerApi = { ...api, createGroup,
            launchSession: (machineId: string, input: Parameters<ApiClient['launchSession']>[1]) => {
                const saved = JSON.parse(sessionStorage.getItem(`hapi:session-composition:${extra.groupId ?? 'standalone'}`) ?? 'null')
                expect(saved?.cards.some((card: { launch?: { input: { requestId: string } } }) => card.launch?.input.requestId === input.requestId)).toBe(true)
                return launchSession(machineId, input)
            },
            getGroups: vi.fn(async () => ({ groups: [{ id: 'existing-group', name: 'Existing', members: [], version: 1, updatedAt: 1 }] })),
            checkMachinePathsExists: vi.fn(async (_id: string, paths: string[]) => ({ exists: Object.fromEntries(paths.map(path => [path, true])) })),
        } as unknown as ApiClient
        const view = render(<ImagePreviewProvider><QueryClientProvider client={client}><SessionComposer api={composerApi} machines={[machine]} initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} {...extra} /></QueryClientProvider></ImagePreviewProvider>)
        await act(async () => {})
        return { ...view, createGroup }
    }

    async function selectPlacement(value: string) {
        const trigger = screen.getByRole('button', { name: /^batch.placement/ })
        await waitFor(() => expect(trigger).toBeEnabled())
        fireEvent.click(trigger)
        fireEvent.click(await screen.findByRole('menuitemradio', { name: value === 'new' ? 'batch.newGroup' : value === 'none' ? 'batch.noGroup' : 'Existing' }))
    }

    async function removeChat(number: number) {
        fireEvent.click(screen.getByRole('button', { name: `batch.remove ${number}` }))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'batch.remove' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }

    async function enterBatchWithOneChat() {
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        await removeChat(2)
        fireEvent.click(within(screen.getByRole('article')).getByRole('button', { expanded: false }))
    }

    it('pastes, previews and removes images, then launches an image-only prompt with its original bytes', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'image-chat' })
        await renderComposer(launch)
        const prompt = screen.getByRole('textbox', { name: 'newSession.initialPrompt' })
        const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
        const paste = () => fireEvent.paste(prompt, { clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } })
        paste()
        expect(await screen.findByRole('img', { name: 'Image' })).toHaveAttribute('src', 'blob:initial-image')
        fireEvent.click(screen.getByRole('button', { name: 'newSession.removeImage' }))
        expect(screen.queryByRole('img', { name: 'Image' })).toBeNull()
        paste()
        await screen.findByRole('img', { name: 'Image' })
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('image-chat', true))
        expect(launch).toHaveBeenCalledTimes(1)
        expect(launch.mock.calls[0][1]).toMatchObject({ initialPrompt: '', initialImages: [
            { filename: 'clipboard.png', mimeType: 'image/png', content: 'aW1hZ2U=' },
        ] })
        expect(mocks.spawnSession).not.toHaveBeenCalled()
    })

    it('attaches selected image files to the initial message', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'file-chat' })
        const view = await renderComposer(launch)
        const file = new File(['image'], 'selected.png', { type: 'image/png' })
        const input = view.container.querySelector('input[type=file]')!
        fireEvent.change(input, { target: { files: [file] } })
        await screen.findByRole('img', { name: 'Image' })
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
        expect(launch.mock.calls[0][1].initialImages).toMatchObject([{ filename: 'selected.png', content: 'aW1hZ2U=' }])
    })

    it('keeps pasted text alongside an image and retains the attachment through adding and returning from another chat', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'image-and-text' })
        await renderComposer(launch)
        const prompt = screen.getByRole('textbox', { name: 'newSession.initialPrompt' }) as HTMLTextAreaElement
        fireEvent.change(prompt, { target: { value: 'Before after' } })
        prompt.setSelectionRange(7, 7)
        const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
        fireEvent.paste(prompt, { clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }], getData: () => 'pasted ' } })
        await screen.findByRole('img', { name: 'Image' })
        expect(prompt).toHaveValue('Before pasted after')
        const textPaste = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(textPaste, 'clipboardData', { value: { items: [], getData: () => 'plain text' } })
        fireEvent(prompt, textPaste)
        expect(textPaste.defaultPrevented).toBe(false)
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        fireEvent.click(screen.getByRole('button', { name: 'batch.singleChat' }))
        expect(await screen.findByRole('img', { name: 'Image' })).toBeVisible()
        expect(screen.getByRole('textbox', { name: 'newSession.initialPrompt' })).toHaveValue('Before pasted after')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
        expect(launch.mock.calls[0][1]).toMatchObject({ initialPrompt: 'Before pasted after', initialImages: [{ content: 'aW1hZ2U=' }] })
    })

    it('rejects oversized and unsupported clipboard images without clearing the prompt', async () => {
        await renderComposer(vi.fn())
        const prompt = screen.getByRole('textbox', { name: 'newSession.initialPrompt' })
        fireEvent.change(prompt, { target: { value: 'Keep my task' } })
        for (const file of [new File(['svg'], 'drawing.svg', { type: 'image/svg+xml' }), new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]) {
            fireEvent.paste(prompt, { clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } })
            expect(await screen.findByRole('alert')).toHaveTextContent('newSession.imagesInvalid')
            expect(prompt).toHaveValue('Keep my task')
            expect(screen.queryByRole('img', { name: 'Image' })).toBeNull()
        }
    })

    it('opens the chat image viewer and keeps images above 2 MB outside the form receipt across retry', async () => {
        const launch = vi.fn().mockResolvedValueOnce({ state: 'indeterminate', message: 'Response lost' })
            .mockResolvedValueOnce({ state: 'succeeded', sessionId: 'large-image-chat' })
        const view = await renderComposer(launch)
        const bytes = new Uint8Array(3 * 1024 * 1024).fill(1)
        const file = new File([bytes], 'large.png', { type: 'image/png' })
        fireEvent.paste(screen.getByRole('textbox', { name: 'newSession.initialPrompt' }), {
            clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
        })
        const preview = await screen.findByRole('img', { name: 'Image' })
        fireEvent.click(preview.closest('button')!)
        expect(await screen.findByRole('dialog')).toBeVisible()
        fireEvent.keyDown(window, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await screen.findByText('batch.indeterminate')
        const receipt = sessionStorage.getItem('hapi:session-composition:standalone')!
        expect(receipt.length).toBeLessThan(10000)
        expect(JSON.parse(receipt).cards[0].initialImages[0]).toMatchObject({ filename: 'large.png', size: bytes.length })
        expect(JSON.parse(receipt).cards[0].initialImages[0].content).toBeUndefined()
        expect(launch.mock.calls[0][1].initialImages[0].content).toBe(Buffer.from(bytes).toString('base64'))
        view.unmount()
        await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'batch.checkResult' }))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('large-image-chat', true))
        expect(launch.mock.calls[1][1]).toEqual(launch.mock.calls[0][1])
    })

    it('keeps ordinary creation on the original form until another chat is requested', async () => {
        const launch = vi.fn()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'ordinary-chat' })
        const { createGroup } = await renderComposer(launch)
        expect(screen.getByRole('textbox', { name: 'groups.name' })).toHaveValue('')
        expect(screen.queryByRole('checkbox', { name: 'groups.createWithChat' })).toBeNull()
        expect(screen.queryByRole('article')).toBeNull()
        expect(screen.queryByRole('textbox', { name: 'batch.commonPrompt' })).toBeNull()
        expect(screen.queryByRole('button', { name: /^batch.placement/ })).toBeNull()
        expect(screen.getByRole('radio', { name: 'newSession.allAgents' })).toBeChecked()
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('ordinary-chat', true))
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1)
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ groupId: undefined }))
        expect(createGroup).not.toHaveBeenCalled()
        expect(launch).not.toHaveBeenCalled()
    })

    it.each(['failed', 'indeterminate'] as const)('launches a single prompt once and restores a %s result for safe recovery', async state => {
        const prompt = '  Inspect this project.\nKeep the full task.\n'
        const launch = vi.fn().mockResolvedValueOnce({ state, message: 'Runner response' })
            .mockResolvedValueOnce({ state: 'succeeded', sessionId: 'prompt-chat' })
        const view = await renderComposer(launch)
        fireEvent.change(screen.getByRole('textbox', { name: 'newSession.initialPrompt' }), { target: { value: prompt } })
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: 'Review' } })
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
        await screen.findByText(state === 'failed' ? 'batch.failed' : 'batch.indeterminate')
        const original = launch.mock.calls[0][1]
        expect(original).toMatchObject({ initialPrompt: prompt, directory: 'C:\\repo', groupId: 'new-group', agent: 'codex', model: 'gpt-6.1-sol', serviceTier: 'fast' })
        expect(view.createGroup).toHaveBeenCalledTimes(1)
        expect(mocks.spawnSession).not.toHaveBeenCalled()
        expect(mocks.sendMessage).not.toHaveBeenCalled()
        view.unmount()
        const restored = await renderComposer(launch)
        expect(launch).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: state === 'failed' ? 'batch.retryChat' : 'batch.checkResult' }))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('prompt-chat', true))
        expect(launch).toHaveBeenCalledTimes(2)
        expect(launch.mock.calls[1][1]).toEqual({ ...original, requestId: expect.any(String) })
        if (state === 'failed') expect(launch.mock.calls[1][1].requestId).not.toBe(original.requestId)
        else expect(launch.mock.calls[1][1].requestId).toBe(original.requestId)
        expect(restored.createGroup).not.toHaveBeenCalled()
        expect(sessionStorage.getItem('hapi:session-composition:standalone')).toBeNull()
    })

    it('keeps a newer launch recoverable when an earlier visit finishes in the background', async () => {
        type Result = Awaited<ReturnType<ApiClient['launchSession']>>
        let finishFirst!: (result: Result) => void
        let finishSecond!: (result: Result) => void
        const launch = vi.fn()
            .mockImplementationOnce(() => new Promise<Result>(resolve => { finishFirst = resolve }))
            .mockImplementationOnce(() => new Promise<Result>(resolve => { finishSecond = resolve }))
        const first = await renderComposer(launch)
        fireEvent.change(screen.getByRole('textbox', { name: 'newSession.initialPrompt' }), { target: { value: 'First task' } })
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
        first.unmount()
        await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'batch.prepareMore' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'batch.commonPrompt' }), { target: { value: 'Second task' } })
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchOne' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchOne' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
        const secondRequest = launch.mock.calls[1][1]
        expect(secondRequest.initialPrompt).toBe('Second task')
        await act(async () => { finishFirst({ state: 'succeeded', sessionId: 'first' }) })
        const saved = JSON.parse(sessionStorage.getItem('hapi:session-composition:standalone') ?? 'null')
        expect(saved?.cards[0].launch.input).toEqual(secondRequest)
        await act(async () => { finishSecond({ state: 'succeeded', sessionId: 'second' }) })
        expect(sessionStorage.getItem('hapi:session-composition:standalone')).toBeNull()
    })

    it('keeps a single prompt when adding chats and brings back the first chat override', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'one-chat' })
        await renderComposer(launch)
        fireEvent.change(screen.getByRole('textbox', { name: 'newSession.initialPrompt' }), { target: { value: 'Shared task' } })
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        expect(screen.getByRole('textbox', { name: 'batch.commonPrompt' })).toHaveValue('Shared task')
        const first = screen.getAllByRole('article')[0]
        fireEvent.click(within(first).getByRole('button', { expanded: false, name: /Codex/ }))
        fireEvent.change(within(first).getByRole('textbox', { name: 'batch.chatPrompt' }), { target: { value: 'Individual task' } })
        fireEvent.click(screen.getByRole('button', { name: 'batch.singleChat' }))
        expect(screen.getByRole('textbox', { name: 'newSession.initialPrompt' })).toHaveValue('Individual task')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('one-chat', true))
        expect(launch).toHaveBeenCalledTimes(1)
        expect(launch.mock.calls[0][1]).toMatchObject({ initialPrompt: 'Individual task' })
    })

    it('returns to ordinary creation with the first chat settings and clears the batch mode', async () => {
        const launch = vi.fn()
        const view = await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        await selectPlacement('new')
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: 'Review' } })
        fireEvent.click(screen.getByRole('button', { name: 'batch.singleChat' }))
        expect(screen.queryByRole('article')).toBeNull()
        expect(await screen.findByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('textbox', { name: 'groups.name' })).toHaveValue('Review')
        expect(screen.getByLabelText('directory-test')).toHaveValue('C:\\repo')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'returned-chat' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('returned-chat', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6-luna', groupId: 'new-group' }))
        expect(launch).not.toHaveBeenCalled()
        view.unmount()
        await renderComposer(launch)
        expect(screen.queryByRole('article')).toBeNull()
    })

    it.each(['none', 'existing-group'])('keeps placement %s when returning to one chat from an open group', async placement => {
        await renderComposer(vi.fn(), { groupId: 'existing-group' })
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: 'Temporary group' } })
        expect(screen.getByRole('button', { name: /^batch.placement/ })).toHaveTextContent('batch.newGroup')
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: '' } })
        expect(screen.getByRole('button', { name: /^batch.placement/ })).toHaveTextContent('batch.noGroup')
        await selectPlacement(placement)
        fireEvent.click(screen.getByRole('button', { name: 'batch.singleChat' }))
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'placed-chat' })
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('placed-chat', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ groupId: placement === 'none' ? undefined : 'existing-group' }))
    })

    it('preserves a prepared chat on cancel and removes only the confirmed chat', async () => {
        const launch = vi.fn()
        await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        const second = screen.getAllByRole('article')[1]
        fireEvent.change(within(second).getByRole('textbox', { name: 'batch.chatPrompt' }), { target: { value: 'Keep this task until removal is confirmed.' } })
        fireEvent.click(screen.getByRole('button', { name: 'batch.remove 2' }))
        expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(2)
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'button.cancel' }))
        expect(within(second).getByRole('textbox', { name: 'batch.chatPrompt' })).toHaveValue('Keep this task until removal is confirmed.')
        await removeChat(2)
        expect(screen.getAllByRole('article')).toHaveLength(1)
        expect(screen.getByRole('article')).not.toBe(second)
        expect(launch).not.toHaveBeenCalled()
    })

    it('cancels the batch draft so opening Create Session again starts with one chat', async () => {
        const launch = vi.fn()
        const onCancel = vi.fn()
        const view = await renderComposer(launch, { onCancel })
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }))
        expect(onCancel).toHaveBeenCalledOnce()
        view.unmount()
        await renderComposer(launch)
        expect(screen.queryByRole('article')).toBeNull()
        expect(screen.getByRole('button', { name: 'batch.addAnother' })).toBeVisible()
        expect(launch).not.toHaveBeenCalled()
    })

    it('allows preparing another chat before the group name is filled', async () => {
        const { ActionButtons } = await vi.importActual<typeof import('./ActionButtons')>('./ActionButtons')
        const onAddChat = vi.fn()
        render(<ActionButtons isPending={false} isDisabled={false} canCreate={false} onCancel={() => {}} onCreate={() => {}} onAddChat={onAddChat} />)
        expect(screen.getByRole('button', { name: 'newSession.create' })).toBeDisabled()
        const add = screen.getByRole('button', { name: 'batch.addAnother' })
        expect(add).toBeEnabled()
        fireEvent.click(add)
        expect(onAddChat).toHaveBeenCalledOnce()
    })

    it('finishes naming a group after adding chats and keeps the first chat model and Fast setting', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'started' })
        const { createGroup } = await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: 'Compare' } })
        const first = screen.getAllByRole('article')[0]
        expect(within(first).getByText('GPT-6.1 Terra Fast')).toBeVisible()
        const summary = within(first).getByRole('button', { expanded: false })
        expect(within(summary).getByText('Codex', { exact: true })).toBeVisible()
        expect(within(first).getByText('C:\\repo', { exact: true })).toBeVisible()
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchCount' })).toBeEnabled())
        expect(createGroup).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchCount' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
        expect(createGroup).toHaveBeenCalledWith('Compare', expect.any(String))
        expect(launch.mock.calls[0][1]).toMatchObject({ groupId: 'new-group', serviceTier: 'fast', directory: 'C:\\repo' })
        expect(launch.mock.calls[0][1]).toMatchObject({ model: 'gpt-6.1-terra' })
        expect(launch.mock.calls[0][1].modelReasoningEffort).toBeUndefined()
    })

    it('keeps independent model pairs and Speed when duplicating and launching multiple cards', async () => {
        mocks.cursorModels = [{ modelId: 'composer-2.5' }]
        mocks.cursorSkus = [{ modelId: 'composer-2.5-fast' }]
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'started' })
        await renderComposer(launch)
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        const second = screen.getAllByRole('article')[1]
        fireEvent.click(await within(second).findByRole('button', { name: 'Composer 2.5' }))
        fireEvent.click(within(second).getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(within(second).getByRole('radio', { name: 'Cursor' }))
        fireEvent.click(screen.getByRole('button', { name: 'batch.duplicate 2' }))
        const third = screen.getAllByRole('article')[2]
        expect(within(third).getByRole('radio', { name: 'Cursor' })).toBeChecked()
        expect(await within(third).findByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'true')
        expect(within(third).getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(third).getByRole('radio', { name: 'newSession.allAgents' }))
        fireEvent.click(within(third).getByRole('button', { name: 'GPT-6 Luna' }))
        expect(within(third).queryByRole('button', { name: 'misc.fastModeFast' })).toBeNull()
        expect(within(third).getByRole('button', { name: /Codex GPT-6 Luna/ })).toBeVisible()
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchCount' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchCount' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(3))
        expect(launch.mock.calls.map(call => [call[1].agent, call[1].model, call[1].serviceTier])).toEqual([
            ['codex', 'gpt-6.1-terra', 'fast'], ['cursor', 'composer-2.5-fast', undefined], ['codex', 'gpt-6-luna', undefined],
        ])
    })

    it('hides effort in model choices while keeping it in card summaries, duplication and launches', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'started' })
        await renderComposer(launch)
        const muse = screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })
        expect(muse).not.toHaveTextContent('(Medium)')
        fireEvent.click(muse)
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        const second = screen.getAllByRole('article')[1]
        const argon = await within(second).findByRole('button', { name: 'Gemini 4 Argon (High)' })
        expect(argon).not.toHaveTextContent('(High)')
        fireEvent.click(argon)
        expect(within(screen.getAllByRole('article')[0]).getByText('Muse Spark 1.3 (Medium)')).toBeVisible()
        expect(within(second).getByText('Gemini 4 Argon (High)')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'batch.duplicate 1' }))
        const duplicate = screen.getAllByRole('article')[2]
        expect(within(duplicate).getByText('Muse Spark 1.3 (Medium)')).toBeVisible()
        expect(await within(duplicate).findByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).toHaveAttribute('aria-pressed', 'true')
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchCount' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchCount' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(3))
        expect(launch.mock.calls.map(call => [call[1].agent, call[1].model, call[1].modelReasoningEffort])).toEqual([
            ['opencode', 'opencode-go/muse-spark-1.3-contributor', 'medium'],
            ['opencode', 'opencode-go/gemini-4-argon', 'high'],
            ['opencode', 'opencode-go/muse-spark-1.3-contributor', 'medium'],
        ])
    })

    it('launches duplicate settings concurrently with replacement prompts, project overrides and one shared new group; retries only the rejected chat', async () => {
        const commonPrompt = 'Compare the approaches.\n'.repeat(80)
        const ownPrompt = 'Review security only.\n'.repeat(60)
        let resolveFirst!: (result: unknown) => void
        const first = new Promise(resolve => { resolveFirst = resolve })
        const launch = vi.fn().mockImplementationOnce(() => first)
            .mockResolvedValueOnce({ state: 'failed', message: 'Not installed' })
            .mockResolvedValueOnce({ state: 'succeeded', sessionId: 'second-chat' })
        const { createGroup } = await renderComposer(launch)
        expect(screen.queryByRole('textbox', { name: 'batch.commonPrompt' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: 'Comparison' } })
        fireEvent.click(screen.getByRole('button', { name: 'batch.addAnother' }))
        expect(screen.getByRole('button', { name: /^batch.placement/ })).toHaveTextContent('batch.newGroup')
        expect(screen.getByRole('textbox', { name: 'groups.name' })).toHaveValue('Comparison')
        expect(createGroup).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('textbox', { name: 'batch.commonPrompt' }), { target: { value: commonPrompt } })
        await removeChat(2)
        fireEvent.click(screen.getByRole('button', { name: 'batch.duplicate 1' }))
        const sharedCard = screen.getAllByRole('article')[0]
        expect(within(sharedCard).queryByText(/Compare the approaches\./)).toBeNull()
        const sharedPreview = within(sharedCard).getByRole('button', { name: 'batch.showSharedPrompt' })
        fireEvent.click(sharedPreview)
        expect(within(sharedCard).getByRole('region', { name: 'batch.showSharedPrompt' }).textContent).toBe(commonPrompt)
        fireEvent.click(sharedPreview)
        expect(within(sharedCard).queryByRole('region', { name: 'batch.showSharedPrompt' })).toBeNull()
        const second = screen.getAllByRole('article')[1]
        expect(await within(second).findByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.change(within(second).getByRole('textbox', { name: 'batch.chatPrompt' }), { target: { value: ownPrompt } })
        fireEvent.click(within(second).getByRole('button', { name: 'batch.otherProject' }))
        fireEvent.change(within(second).getByLabelText('directory-test'), { target: { value: 'C:\\other' } })
        fireEvent.click(within(second).getByRole('button', { expanded: true }))
        expect(within(second).queryByRole('region', { name: 'batch.showCustomPrompt' })).toBeNull()
        const ownPreview = within(second).getByRole('button', { name: 'batch.showCustomPrompt' })
        fireEvent.click(ownPreview)
        expect(within(second).getByRole('region', { name: 'batch.showCustomPrompt' }).textContent).toBe(ownPrompt)
        expect(within(second).queryByText(/Compare the approaches\./)).toBeNull()
        fireEvent.click(ownPreview)
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchCount' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchCount' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
        expect(createGroup).toHaveBeenCalledTimes(1)
        expect(launch.mock.calls[0]).toEqual(['machine-1', expect.objectContaining({ groupId: 'new-group', model: 'gpt-6-luna', initialPrompt: commonPrompt, directory: 'C:\\repo' })])
        expect(launch.mock.calls[1]).toEqual(['machine-1', expect.objectContaining({ groupId: 'new-group', model: 'gpt-6-luna', initialPrompt: ownPrompt, directory: 'C:\\other' })])
        await waitFor(() => expect(within(second).getByRole('button', { name: 'batch.retryChat' })).toBeEnabled())
        fireEvent.click(within(second).getByRole('button', { name: 'batch.retryChat' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(3))
        expect(launch.mock.calls[2][1]).toEqual({ ...launch.mock.calls[1][1], requestId: expect.any(String) })
        expect(launch.mock.calls[2][1].requestId).not.toBe(launch.mock.calls[1][1].requestId)
        await act(async () => resolveFirst({ state: 'succeeded', sessionId: 'first-chat' }))
        await waitFor(() => expect(screen.getAllByText('batch.succeeded')).toHaveLength(2))
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
        expect(mocks.sendMessage).not.toHaveBeenCalled()
    })

    it('checks an unknown launch with its original request and restores the result after remount', async () => {
        const launch = vi.fn().mockRejectedValueOnce(new Error('Response lost'))
            .mockResolvedValueOnce({ state: 'succeeded', sessionId: 'late-chat' })
        const view = await renderComposer(launch, { groupId: 'existing-group', initialAgent: 'claude' })
        await enterBatchWithOneChat()
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchOne' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchOne' }))
        await waitFor(() => expect(screen.getByText('batch.indeterminate')).toBeVisible())
        expect(launch.mock.calls[0][1]).toMatchObject({ groupId: 'existing-group', agent: 'claude', initialPrompt: '' })
        view.unmount()
        await renderComposer(launch, { groupId: 'existing-group' })
        expect(screen.queryByRole('button', { name: 'batch.retryChat' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'batch.checkResult' }))
        await waitFor(() => expect(screen.getByText('batch.succeeded')).toBeVisible())
        expect(launch.mock.calls[1]).toEqual(launch.mock.calls[0])
        expect(mocks.sendMessage).not.toHaveBeenCalled()
    })

    it('uses the common prompt when the individual prompt is empty and permits an empty regular chat', async () => {
        const launch = vi.fn().mockResolvedValue({ state: 'succeeded', sessionId: 'chat' })
        const view = await renderComposer(launch)
        await enterBatchWithOneChat()
        fireEvent.change(screen.getByRole('textbox', { name: 'batch.commonPrompt' }), { target: { value: 'Common task' } })
        fireEvent.change(screen.getByRole('textbox', { name: 'batch.chatPrompt' }), { target: { value: '   ' } })
        await selectPlacement('new')
        expect(screen.getByRole('textbox', { name: 'groups.name' })).toHaveValue('')
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchOne' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchOne' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
        expect(launch.mock.calls[0][1]).toMatchObject({ initialPrompt: 'Common task', groupId: undefined })
        view.unmount()
        sessionStorage.clear()
        await renderComposer(launch)
        await enterBatchWithOneChat()
        await waitFor(() => expect(screen.getByRole('button', { name: 'batch.launchOne' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'batch.launchOne' }))
        await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
        expect(launch.mock.calls[1][1]).toMatchObject({ initialPrompt: '', groupId: undefined })
    })

    it('uses the managed default and keeps a manual choice while preferences load', async () => {
        mocks.projectsLoading = true
        mocks.projectPreferences = [{ machineId: 'machine-1', path: '/code/hapi', alias: 'HAPI', section: 'auto', priority: false, isDefault: true }]
        const view = render(<NewSession api={api} machines={[machine]} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.change(screen.getByLabelText('directory-test'), { target: { value: '/code/manual' } })
        mocks.projectsLoading = false
        view.rerender(<NewSession api={api} machines={[machine]} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.getByLabelText('directory-test')).toHaveValue('/code/manual')
        view.unmount()
        render(<NewSession api={api} machines={[machine]} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByLabelText('directory-test')).toHaveValue('/code/hapi'))
    })

    it('creates an optional named group and reuses its request after a failed launch', async () => {
        const createGroup = vi.fn(async () => ({ group: { id: 'created-group', name: 'HAPI' } }))
        mocks.spawnSession.mockRejectedValueOnce(new Error('Runner unavailable')).mockResolvedValueOnce({ type: 'success', sessionId: 'new-chat' })
        render(<NewSession api={{ ...api, createGroup } as unknown as ApiClient} machines={[machine]} initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('textbox', { name: 'groups.name' })).toHaveValue('')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: '  HAPI  ' } })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('new-chat', true))
        expect(createGroup).toHaveBeenCalledTimes(2)
        expect(createGroup.mock.calls[0]).toEqual(['HAPI', expect.any(String)])
        expect(createGroup.mock.calls[1]).toEqual(createGroup.mock.calls[0])
        expect(mocks.spawnSession).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'created-group' }))
    })

    it('uses the group agent instead of global preferences, allows changing it and retains group membership', async () => {
        savePreferredAgent('claude')
        saveNewSessionFormDraft({
            agent: 'cursor', model: 'auto', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: '',
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'group-chat' })
        render(<NewSession api={api} machines={[machine]} groupId="group" groupName="HAPI" initialAgent="codex" initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('radio', { name: 'newSession.allAgents' })).toBeChecked()
        expect(screen.queryByRole('checkbox', { name: 'groups.createWithChat' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Claude' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group', agent: 'claude', directory: 'C:\\repo' })))
    })

    it('falls back to an available group agent with an explanation', async () => {
        mocks.availableAgents = mocks.availableAgents.filter(entry => entry.agent !== 'claude')
        render(<NewSession api={api} machines={[machine]} groupId="group" initialAgent="claude" initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('radio', { name: 'newSession.allAgents' })).toBeChecked())
        expect(screen.getByRole('status')).toHaveTextContent('groups.defaultsUnavailable')
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it('hides unavailable Agents and falls back to the first available Agent', async () => {
        savePreferredAgent('claude')
        mocks.availableAgents.splice(
            0,
            mocks.availableAgents.length,
            { agent: 'codex', available: true, defaultModelName: undefined }
        )

        render(
            <NewSession initialAgent="claude"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => expect(screen.getByDisplayValue('all')).toBeChecked())
        expect(screen.queryByDisplayValue('claude')).not.toBeInTheDocument()
    })

    it('refuses a directory rejected by workspace-root validation', async () => {
        mocks.checkPathsExists.mockImplementation(async ([path]: string[]) => ({
            exists: { [path]: false },
            outsideWorkspaceRoots: [path]
        }))
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'unexpected' })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(screen.getByText('newSession.directoryOutsideWorkspaceRoots')).toBeInTheDocument())
        expect(mocks.spawnSession).not.toHaveBeenCalled()
    })

    it('ignores a saved Codex model and agent-wide effort', async () => {
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'gpt-5.6-sol',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'high',
            permissionMode: 'safe-yolo'
        })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
            expect(within(screen.getByRole('group', { name: 'newSession.effort' })).queryByRole('button', { pressed: true })).toBeNull()
        })
    })

    it.each(['grok', 'kimi', 'pi'] as const)('names the %s native default without pinning it at launch', async (agent) => {
        savePreferredAgent(agent)
        if (agent === 'grok') {
            mocks.grokModels = [{ modelId: 'native-default', name: 'Native model' }]
            mocks.grokCurrentModelId = 'native-default'
        } else if (agent === 'kimi') {
            mocks.kimiModels = [{ modelId: 'native-default', name: 'Native model' }]
            mocks.kimiCurrentModelId = 'native-default'
        } else {
            mocks.piModels = [{ modelId: 'native-default', name: 'Native model', provider: 'local' }]
            mocks.piCurrentModelId = 'local/native-default'
        }
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'native-session' })
        render(<NewSession initialAgent={agent} api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByTestId('model-options').textContent).toBe('Native model')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent, model: undefined })))
    })

    it('keeps the restored GLM draft after model preferences load', async () => {
        setClaudeGlmBranded(true)
        mocks.modelPreferences = [{ agent: 'claude', modelId: 'glm-5.3', pinned: true, alias: null }]
        saveNewSessionFormDraft({
            agent: 'claude', model: 'glm-5.3', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'bypassPermissions',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'glm-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'GLM 5.3' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', model: 'glm-5.3' })))
        setClaudeGlmBranded(false)
    })

    it('does not attribute the previous GLM model to Codex while its catalog is loading', async () => {
        setClaudeGlmBranded(true)
        mocks.modelPreferences = [
            { agent: 'claude', modelId: 'glm-5.3', pinned: true, alias: null },
            { agent: 'codex', modelId: 'gpt-6-luna', pinned: false, hidden: true, alias: null },
            { agent: 'codex', modelId: 'gpt-6-sol', pinned: false, hidden: true, alias: null }
        ]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3' }))
        mocks.codexModelsLoading = true
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.queryByRole('button', { name: 'glm-5.3', description: 'Codex' })).toBeNull()
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        setClaudeGlmBranded(false)
    })

    it('keeps the selected Codex model when its catalog fails after switching from GLM', async () => {
        setClaudeGlmBranded(true)
        mocks.modelPreferences = [{ agent: 'claude', modelId: 'glm-5.3', pinned: true, alias: null }]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'codex-session' })
        const view = render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3' }))
        mocks.codexModelsLoading = true
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        mocks.codexModelsLoading = false
        mocks.codexModelsError = 'Catalog unavailable'
        view.rerender(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6.1-terra' })))
        setClaudeGlmBranded(false)
    })

    it('keeps the last model selected when agent switches are batched', async () => {
        setClaudeGlmBranded(true)
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'codex-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3' }))
            fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        })
        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6.1-sol' })))
        setClaudeGlmBranded(false)
    })

    it('switches from GLM to Codex without carrying the GLM model into the selection or launch', async () => {
        setClaudeGlmBranded(true)
        mocks.modelPreferences = [
            { agent: 'claude', modelId: 'glm-5.3', pinned: true, alias: null },
            { agent: 'claude', modelId: 'auto', pinned: true, alias: null, showInAll: false },
            { agent: 'codex', modelId: 'gpt-6-luna', pinned: false, hidden: true, alias: null },
            { agent: 'codex', modelId: 'gpt-6-sol', pinned: false, hidden: true, alias: null },
            { agent: 'codex', modelId: 'gpt-6.1-sol', pinned: false, alias: null },
            { agent: 'codex', modelId: 'gpt-6.1-terra', pinned: false, alias: null }
        ]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'codex-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3' }))
            fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        })
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.queryByRole('button', { name: 'glm-5.3', description: 'Codex' })).toBeNull()
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6.1-terra' })))
        setClaudeGlmBranded(false)
    })

    it('uses configured agent order, visibility and first model with its saved speed', async () => {
        setClaudeGlmBranded(true)
        mocks.modelPreferences = [
            { agent: 'claude', modelId: 'glm-5.3', pinned: true, alias: null },
            { agent: 'codex', modelId: 'gpt-6.1-sol', pinned: true, alias: null, speed: 'standard' },
            { agent: 'codex', modelId: 'gpt-6.1-terra', pinned: true, alias: null, showInAll: false }
        ]
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'codex', { model: 'gpt-6.1-terra', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'fast' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'true'))
        const buttons = within(screen.getByRole('region', { name: 'newSession.model' })).getAllByRole('button')
        expect(buttons[0]).toHaveAttribute('aria-label', 'GPT-6.1 Sol')
        expect(screen.queryByRole('button', { name: 'GPT-6.1 Terra' })).toBeNull()
        expect(buttons.findIndex(button => button.getAttribute('aria-label') === 'GLM 5.3')).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6.1-sol', serviceTier: 'standard' })))
        setClaudeGlmBranded(false)
    })

    it('applies Cursor speed separately for each chosen model', async () => {
        mocks.cursorModels = [{ modelId: 'composer-2.5' }, { modelId: 'grok-4.7-xhigh' }]
        mocks.cursorSkus = [{ modelId: 'composer-2.5-fast' }, { modelId: 'grok-4.7-xhigh-fast' }]
        mocks.modelPreferences = [
            { agent: 'cursor', modelId: 'composer-2.5', pinned: true, alias: null, speed: 'fast' },
            { agent: 'cursor', modelId: 'grok-4.7-xhigh', pinned: true, alias: null, speed: 'standard' }
        ]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Composer 2.5' })).toBeVisible())
        fireEvent.click(screen.getByRole('button', { name: 'Composer 2.5' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByRole('button', { name: 'Grok 4.7 Extra High' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByRole('button', { name: 'Composer 2.5' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'composer-2.5-fast' })))
    })

    it('saves speed and All agents visibility independently in Manage models', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        fireEvent.change(screen.getByRole('combobox', { name: 'Speed for GPT-6.1 Terra' }), { target: { value: 'standard' } })
        await waitFor(() => expect(mocks.saveModelPreference).toHaveBeenCalledWith(expect.objectContaining({ speed: 'standard' })))
        fireEvent.click(screen.getByRole('checkbox', { name: 'Show GPT-6.1 Terra in All agents' }))
        await waitFor(() => expect(mocks.saveModelPreference).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-6.1-terra', speed: 'standard', showInAll: false })))
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.queryByRole('button', { name: 'GPT-6.1 Terra' })).toBeNull()
    })

    it('keeps model management open while switching agents and restores the form when closed', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        expect(screen.queryByRole('textbox', { name: 'newSession.directory' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Antigravity' }))
        expect(screen.getByRole('radio', { name: 'Antigravity' })).toBeChecked()
        expect(screen.getByRole('button', { name: 'Hide models' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        expect(screen.getByTestId('create')).toBeInTheDocument()
    })

    it('opens Codex on GPT-6.1 Terra with Fast and orders the three requested badges', async () => {
        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6 Sol' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'false')
        expect(within(screen.getByRole('group', { name: 'newSession.effort' })).queryByRole('button', { pressed: true })).toBeNull()
        expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.queryByRole('button', { name: 'GPT-6 Astra' })).toBeNull()
        expect(screen.queryByTestId('model')).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        expect(within(screen.getByRole('region', { name: 'newSession.model' })).getAllByRole('button')
            .slice(0, 3).map(button => button.getAttribute('aria-label')))
            .toEqual(['GPT-6.1 Terra', 'GPT-6 Sol', 'GPT-6.1 Sol'])
    })

    it('uses the Codex catalog name until a user alias replaces it', async () => {
        mocks.codexTerraName = 'Catalog Terra'
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'Catalog Terra' })).toBeVisible()
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        const alias = screen.getByRole('textbox', { name: 'Alias for Catalog Terra' })
        fireEvent.change(alias, { target: { value: 'My Terra' } })
        fireEvent.blur(alias)
        await waitFor(() => expect(mocks.saveModelPreference).toHaveBeenCalledWith(expect.objectContaining({ alias: 'My Terra' })))
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'My Terra' })).toBeVisible())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra' })))
    })

    it('pins a discovered Codex model and applies its saved alias without changing the launch id', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.queryByRole('button', { name: 'Manage models' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        const alias = screen.getByRole('textbox', { name: 'Alias for GPT-5.6 Sol' })
        fireEvent.change(alias, { target: { value: 'My Sol' } })
        fireEvent.blur(alias)
        await waitFor(() => expect(mocks.saveModelPreference).toHaveBeenCalledWith({
            agent: 'codex', modelId: 'gpt-5.6-sol', pinned: false, hidden: false, alias: 'My Sol', reasoningEffort: null, speed: null, showInAll: true
        }))
        fireEvent.click(screen.getByRole('button', { name: 'Add GPT-5.6 Sol' }))
        await waitFor(() => expect(mocks.saveModelPreference).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-5.6-sol', pinned: true })))
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'My Sol' })).toBeInTheDocument())
        expect(within(screen.getByRole('region', { name: 'newSession.model' })).getAllByRole('button')[0]).toHaveAttribute('aria-label', 'My Sol')
        fireEvent.click(screen.getByRole('button', { name: 'My Sol' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-sol' })))
    })

    it('adds a model by ID, reorders models, and removes the selected one', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        fireEvent.change(screen.getByRole('combobox', { name: 'Choose a model' }), { target: { value: '__custom__' } })
        fireEvent.change(screen.getByRole('textbox', { name: 'Model ID' }), { target: { value: 'new-codex-model' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove new-codex-model' })).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Move GPT-6.1 Terra down' }))
        await waitFor(() => expect(mocks.reorderModelPreferences).toHaveBeenCalled())
        fireEvent.click(screen.getByRole('button', { name: 'Remove GPT-6.1 Terra' }))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'GPT-6.1 Terra' })).toBeNull())
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        fireEvent.click(screen.getByRole('button', { name: 'new-codex-model' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'new-codex-model' })))
    })

    it('adds a discovered model from the dropdown', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        fireEvent.change(screen.getByRole('combobox', { name: 'Choose a model' }), { target: { value: 'gpt-5.6-sol' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove GPT-5.6 Sol' })).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Hide models' }))
        expect(screen.getByRole('button', { name: 'GPT-5.6 Sol' })).toBeInTheDocument()
    })

    it('restores the saved effort of the initial Antigravity model', async () => {
        mocks.agyModels = ['low', 'medium', 'high'].map(effort => ({ modelId: `gemini-3.8-flash-${effort}`, name: `Gemini 3.8 Flash (${effort})` }))
        mocks.modelPreferences = [{ agent: 'agy', modelId: 'gemini-3.8-flash', pinned: true, alias: null, reasoningEffort: 'low' }]
        savePreferredAgent('agy')
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(within(screen.getByRole('group', { name: 'newSession.effort' })).getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-3.8-flash-low' })))
    })

    it('keeps a removed Antigravity model hidden and selects an available model when reopened', async () => {
        mocks.agyModels = [
            { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
            { modelId: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)' },
            { modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
        ]
        const props = { initialAgent: 'agy' as const, api, machines: [machine], initialMachineId: 'machine-1', initialDirectory: 'C:\\repo', onSuccess: mocks.onSuccess, onCancel: () => {} }
        const view = render(<NewSession {...props} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Antigravity' }))
        fireEvent.click(screen.getByRole('button', { name: 'Manage models' }))
        fireEvent.click(screen.getByRole('button', { name: 'Remove Gemini 3.8 Flash' }))
        await waitFor(() => expect(mocks.modelPreferences.find(row => row.modelId === 'gemini-3.8-flash')?.hidden).toBe(true))
        view.unmount()
        render(<NewSession {...props} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Antigravity' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 4 Argon' })).toHaveAttribute('aria-pressed', 'true'))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Gemini 3.8 Flash' })).not.toBeInTheDocument())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-4-argon-high' })))
    })

    it('waits for saved model preferences before offering a launch', async () => {
        let resolvePreferences!: (value: { preferences: typeof mocks.modelPreferences }) => void
        const delayedApi = { ...api, getModelPreferences: () => new Promise<{ preferences: typeof mocks.modelPreferences }>(resolve => { resolvePreferences = resolve }) } as ApiClient
        mocks.agyModels = [{ modelId: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)' }]
        render(<NewSession initialAgent="agy" api={delayedApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.getByTestId('create')).toBeDisabled()
        await act(async () => resolvePreferences({ preferences: [{ agent: 'agy', modelId: 'gemini-3.8-flash', pinned: false, alias: null, hidden: true }] }))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        expect(screen.queryByRole('button', { name: 'Gemini 3.8 Flash (High)' })).not.toBeInTheDocument()
    })

    it('groups Antigravity Argon variants and launches the selected effort', async () => {
        mocks.agyModels = ['low', 'medium', 'high'].map(effort => ({ modelId: `gemini-4-argon-${effort}`, name: `Gemini 4 Argon (${effort})` }))
        mocks.modelPreferences = [{ agent: 'agy', modelId: 'gemini-4-argon', pinned: true, alias: 'Argon work', reasoningEffort: 'medium' }]
        savePreferredAgent('agy')
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Argon work' })).toBeVisible())
        fireEvent.click(screen.getByRole('button', { name: 'Argon work' }))
        const effort = screen.getByRole('group', { name: 'newSession.effort' })
        expect(within(effort).getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(effort).getByRole('button', { name: 'Low' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-4-argon-low' })))
    })

    it('launches an explicitly added Antigravity model', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Antigravity' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.6 Flash' })).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Gemini 3.6 Flash' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-3.6-flash-low' })))
    })

    it('shows the curated models directly, filters them by agent and has no Other menu', async () => {
        setClaudeGlmBranded(true)
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.queryByRole('button', { name: 'newSession.model.loadOptions' })).toBeNull()
        expect(screen.getByRole('button', { name: 'GLM 5.3' })).toBeVisible()
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        expect(screen.queryByRole('button', { name: 'GLM 5.3' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.getByRole('button', { name: 'GLM 5.3' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByRole('button', { name: 'newSession.model.loadOptions' })).toBeNull()
        setClaudeGlmBranded(false)
    })

    it.each(['Native model', 'MiniMax M3.1-Flash-Preview'])('shows the minimax native default %s without hiding its release status or pinning it at launch', async defaultModelName => {
        savePreferredAgent('minimax')
        mocks.availableAgents.push({ agent: 'minimax', available: true, defaultModelName })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'native-session' })
        render(<NewSession initialAgent="minimax" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: defaultModelName })).toBeInTheDocument()
        expect(screen.queryByTestId('model')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'minimax', model: undefined })))
    })

    it('uses the new Codex YOLO default independently of another agent legacy value', async () => {
        savePreferredAgent('claude')
        savePreferredYoloMode(true)

        render(
            <NewSession initialAgent="claude"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByDisplayValue('codex'))

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'permission-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' })))
    })

    it('migrates a legacy YOLO value when Codex was the preferred agent', async () => {
        savePreferredAgent('codex')
        savePreferredYoloMode(true)

        render(
            <NewSession initialAgent="codex"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'permission-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' })))
    })

    it('shows discovered Copilot models for the selected directory', async () => {
        mocks.copilotModels = [
            { modelId: 'gpt-5.6', name: 'GPT-5.6' },
            { modelId: 'auto', name: 'Auto' }
        ]

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByLabelText('Copilot'))

        await waitFor(() => {
            expect(screen.getByTestId('model-options')).toHaveTextContent('Auto,GPT-5.6')
        })
    })

    it('starts Copilot at Default even with a remembered model', async () => {
        mocks.copilotModelsLoading = true
        savePreferredAgent('copilot')
        savePreferredLaunchSettings('machine-1', 'copilot', {
            model: 'gpt-5.6',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'default'
        })

        render(
            <NewSession initialAgent="copilot"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        // Auto needs no catalog validation, so creation is not blocked.
        await waitFor(() => expect(screen.getByTestId('model')).toHaveTextContent('auto'))
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it('shows dynamic Kimi models with Default for the selected directory', async () => {
        mocks.kimiModels = [
            { modelId: 'GLM-5.3-flash', name: 'thehive / GLM-5.3-flash', provider: 'thehive' },
            { modelId: 'deepseek-v4.1-flash', name: 'thehive / hive-deepseek', provider: 'thehive' },
            { modelId: 'hyper-glm-5.3-flash', name: 'charm-hyper / Hyper · GLM-5.3-Flash', provider: 'charm-hyper' },
            { modelId: 'openrouter-union-alpha', provider: 'openrouter' }
        ]

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory={'C:\\repo'}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByDisplayValue('kimi'))

        await waitFor(() => {
            expect(screen.getByTestId('model-options')).toHaveTextContent(
                'Default,thehive — thehive / GLM-5.3-flash,thehive — thehive / hive-deepseek,charm-hyper — charm-hyper / Hyper · GLM-5.3-Flash,openrouter — openrouter-union-alpha'
            )
        })
    })

    it('starts Kimi at Default even with a remembered alias', async () => {
        mocks.kimiModels = [
            { modelId: 'GLM-5.3-flash', provider: 'thehive' }
        ]
        savePreferredAgent('kimi')
        savePreferredLaunchSettings('machine-1', 'kimi', {
            model: 'GLM-5.3-flash',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'default'
        })

        render(
            <NewSession initialAgent="kimi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory={'C:\\repo'}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('model')).toHaveTextContent('auto')
            expect(screen.getByTestId('create')).toBeEnabled()
        })
    })

    it('resets a remembered Kimi alias that the dynamic catalog no longer lists', async () => {
        mocks.kimiModels = [
            { modelId: 'GLM-5.3-flash', provider: 'thehive' }
        ]
        savePreferredAgent('kimi')
        savePreferredLaunchSettings('machine-1', 'kimi', {
            model: 'retired-alias',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'default'
        })

        render(
            <NewSession initialAgent="kimi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory={'C:\\repo'}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('model')).toHaveTextContent('auto')
        })
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it('hides a remembered Codex effort while its catalog loads', async () => {
        mocks.codexModelsLoading = true
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'xhigh'
        })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        expect(screen.queryByTestId('reasoning')).toBeNull()
        expect(screen.getByTestId('create')).toBeDisabled()
    })

    it.each([
        ['grok', {
            model: 'grok-4',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default'
        }],
    ] as const)('disables creation while %s cwd existence is unresolved', async (
        agent,
        settings
    ) => {
        mocks.directoryExists = undefined
        savePreferredAgent(agent)
        savePreferredLaunchSettings('machine-1', agent, settings)

        render(
            <NewSession initialAgent={agent}
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        mocks.nextModelValue = 'grok-4'
        fireEvent.click(screen.getByTestId('model'))
        await waitFor(() => expect(screen.getByTestId('create')).toBeDisabled())
    })

    it('does not save launch settings after creation succeeds', async () => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'session-1' })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' }))
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
    })

    it('pins the hardcoded AGY badge even when a restored draft names a removed model', async () => {
        savePreferredAgent('agy')
        mocks.agyModels = [
            { modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' },
            { modelId: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' }
        ]
        saveNewSessionFormDraft({
            agent: 'agy', model: 'claude-opus-4-6-thinking', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.queryByRole('button', { name: 'Claude Opus 4.6 (Thinking)' })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
    })

    it('keeps Antigravity on Gemini 3.8 Flash High when a browse-return draft names another model', async () => {
        savePreferredAgent('agy')
        saveNewSessionFormDraft({
            agent: 'agy', model: 'gemini-3.6-flash-low', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toHaveAttribute('aria-pressed', 'true'))
        expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toHaveTextContent('(High)')
        expect(screen.queryByRole('button', { name: 'Gemini 3.6 Flash (Low)' })).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-3.8-flash-high' })))
    })

    it('keeps the hardcoded AGY badge when a browse-return draft names an unadvertised model', async () => {
        savePreferredAgent('agy')
        saveNewSessionFormDraft({
            agent: 'agy', model: 'removed-model', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
    })

    it('keeps the hardcoded AGY badge when the machine catalog changes under the form', async () => {
        // The machine refreshes its catalog in the background; the hardcoded
        // badge does not depend on it, so it never flickers or resets.
        savePreferredAgent('agy')
        const view = render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())

        mocks.agyModels = [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }]
        view.rerender(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash' })).toBeInTheDocument())
    })

    it('pins the hardcoded AGY badge even with a remembered model, without blocking creation', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'removed-model', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
    })

    it('starts AGY at the hardcoded default even with a remembered model', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'gemini-3.6-flash-low', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        mocks.agyModelsLoading = true
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        // Default needs no catalog validation, so creation is not blocked.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it('launches Antigravity as Gemini 3.8 Flash High', async () => {
        savePreferredAgent('agy')
        mocks.agyModelsLoading = true
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Antigravity' }))
        const high = screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })
        expect(high).toHaveAttribute('aria-pressed', 'true')
        expect(high).toHaveTextContent('(High)')
        expect(high.querySelector('svg')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeNull()
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'agy', model: 'gemini-3.8-flash-high'
        })))
    })


    it('does not forward the global YOLO preference to managed DSH ACP', async () => {
        savePreferredAgent('dsh')
        savePreferredYoloMode(true)
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'dsh-session' })
        render(<NewSession initialAgent="dsh" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('dsh-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'dsh',
            yolo: undefined,
            permissionMode: undefined
        }))
    })

    it('launches Claude with its native YOLO mode while the permission field is hidden', async () => {
        savePreferredAgent('claude')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            yolo: undefined,
            permissionMode: 'bypassPermissions'
        }))
    })

    it('uses Claude permissions after switching from Codex', async () => {
        savePreferredAgent('codex')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession initialAgent="codex" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        // Switching flavors keeps each agent's own YOLO-equivalent launch mode.
        await waitFor(() => expect(screen.getByDisplayValue('all')).toBeChecked())
        fireEvent.click(screen.getByDisplayValue('claude'))
        await waitFor(() => expect(screen.getByDisplayValue('claude')).toBeChecked())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            permissionMode: 'bypassPermissions'
        }))
    })

    it('migrates a legacy YOLO value owned by Claude to bypassPermissions', async () => {
        savePreferredAgent('claude')
        savePreferredYoloMode(true)

        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'permission-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'bypassPermissions' })))
    })

    it('lands Claude on its own YOLO-equivalent default instead of another flavor\'s legacy YOLO inheritance', async () => {
        // hapi:newSession:yolo is a flavor-agnostic global key. The legacyYoloAgent
        // snapshot (captured once at mount, see index.tsx) is what stops a YOLO
        // toggle left on under cursor from being inherited by Claude. Fork:
        // Claude still opens at its YOLO-equivalent mode — as the default, not
        // as an inheritance from another flavor's toggle.
        savePreferredAgent('cursor')
        savePreferredYoloMode(true)

        render(<NewSession initialAgent="cursor" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        await waitFor(() => expect(screen.getByDisplayValue('all')).toBeChecked())
        fireEvent.click(screen.getByDisplayValue('claude'))

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'permission-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'bypassPermissions' })))
    })

    it('keeps the effort field and ignores remembered effort for Claude', async () => {
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'claude', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default'
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        expect(screen.getByTestId('launch-effort')).toHaveTextContent('auto')
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            effort: undefined
        }))
    })

    it('keeps Cursor native default until an explicit badge is picked, using real catalog discovery', async () => {
        mocks.useRealCatalogHooks = true
        savePreferredAgent('cursor')
        mocks.availableAgents.find((entry) => entry.agent === 'cursor')!.defaultModelName = 'Composer 2.5'
        savePreferredLaunchSettings('machine-1', 'cursor', { model: 'composer-2.5', cursorSelectedBase: 'composer-2.5', effort: 'auto', modelReasoningEffort: 'default' })
        const getMachineCursorModels = vi.fn(async () => ({
            success: true,
            availableModels: [{ modelId: 'grok-4.7' }],
            cliModelSkus: [{ modelId: 'grok-4.7-xhigh', name: 'Grok 4.7 Extra High' }],
            currentModelId: null
        }))
        const getMachineOpencodeModelsForCwd = vi.fn(() => new Promise(() => {}))
        const getMachineOpencodeModelVariants = vi.fn()
        const catalogApi = { ...api, getMachineCursorModels, getMachineOpencodeModelsForCwd, getMachineOpencodeModelVariants } as unknown as ApiClient
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'default-session' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = render(<QueryClientProvider client={client}>
            <NewSession initialAgent="cursor" api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)
        await act(async () => {})

        await waitFor(() => expect(getMachineCursorModels).toHaveBeenCalledTimes(1))
        expect(screen.getByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByRole('button', { name: 'misc.fastModeFast' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Grok 4.7 Extra High' }))
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'grok-4.7-xhigh' })))
        view.unmount()
        client.clear()
    })

    it('loads OpenCode choices while allowing its default launch before discovery finishes', async () => {
        mocks.useRealCatalogHooks = true
        savePreferredAgent('opencode')
        savePreferredLaunchSettings('machine-1', 'opencode', { model: 'composer-2.5', cursorSelectedBase: 'composer-2.5', effort: 'auto', modelReasoningEffort: 'default' })
        const getMachineCursorModels = vi.fn(() => new Promise(() => {}))
        const getMachineOpencodeModelsForCwd = vi.fn(() => new Promise(() => {}))
        const getMachineOpencodeModelVariants = vi.fn()
        const catalogApi = { ...api, getMachineCursorModels, getMachineOpencodeModelsForCwd, getMachineOpencodeModelVariants } as unknown as ApiClient
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'default-session' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = render(<QueryClientProvider client={client}>
            <NewSession initialAgent="opencode" api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)
        await act(async () => {})

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        expect(getMachineCursorModels.mock.calls.length).toBe(0)
        await waitFor(() => expect(mocks.opencodeModelsEnabled).toBe(true))
        await waitFor(() => expect(getMachineOpencodeModelsForCwd).toHaveBeenCalledTimes(1))
        expect(screen.queryByRole('button', { name: 'newSession.model.loadOptions' })).toBeNull()
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon',
            modelReasoningEffort: 'high'
        })))
        view.unmount()
        client.clear()
    })

    it('launches the OpenCode hardcoded badge while model discovery is pending', async () => {
        mocks.useRealCatalogHooks = true
        savePreferredAgent('opencode')
        const getMachineOpencodeModelsForCwd = vi.fn(() => new Promise(() => {}))
        const getMachineOpencodeModelVariants = vi.fn()
        const catalogApi = { ...api, getMachineOpencodeModelsForCwd, getMachineOpencodeModelVariants } as unknown as ApiClient
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'default-session' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = render(<QueryClientProvider client={client}>
            <NewSession initialAgent="opencode" api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)
        await act(async () => {})

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).toBeInTheDocument()
        await waitFor(() => expect(getMachineOpencodeModelsForCwd).toHaveBeenCalledTimes(1))
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon',
            modelReasoningEffort: 'high'
        })))
        view.unmount()
        client.clear()
    })


    it('launches DeepSeek V4.1 Flash from the quick pick even when the discovered catalog omits it', async () => {
        savePreferredAgent('opencode')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'deepseek-session' })
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash (Max)' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash (Max)' })).toHaveAttribute('aria-pressed', 'true'))
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).toHaveAttribute('aria-pressed', 'false')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'opencode-go/deepseek-v4.1-flash'
        })))
    })

    it('uses saved OpenCode effort for each model and allows a launch override', async () => {
        mocks.directoryExists = true
        savePreferredAgent('opencode')
        mocks.opencodeVariants = {
            'opencode-go/gemini-4-argon': ['low', 'medium', 'high'],
            'opencode-go/deepseek-v4.1-flash': ['low', 'high', 'max']
        }
        mocks.modelPreferences = [
            { agent: 'opencode', modelId: 'opencode-go/gemini-4-argon', pinned: true, alias: null, reasoningEffort: 'low' },
            { agent: 'opencode', modelId: 'opencode-go/deepseek-v4.1-flash', pinned: true, alias: null, reasoningEffort: 'high' }
        ]
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        const effort = screen.getByRole('group', { name: 'newSession.effort' })
        await waitFor(() => expect(within(effort).getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash (Max)' }))
        expect(within(effort).getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(effort).getByRole('button', { name: 'Low' }))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled(), { timeout: 5000 })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', modelReasoningEffort: 'low' })))
    })

    it('sends a manually selected OpenCode effort even for a quick pick with a pinned default', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariants = { 'opencode-go/gemini-4-argon': ['low', 'high'] }
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        const effort = screen.getByRole('group', { name: 'newSession.effort' })
        expect(within(effort).getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(effort).getByRole('button', { name: 'Low' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'opencode-go/gemini-4-argon', modelReasoningEffort: 'low'
        })))
    })

    it.each([false, true])('launches Gemini 4 Argon at high effort when returning to its default badge: %s', async (returnToDefault) => {
        savePreferredAgent('opencode')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'opencode-session' })
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        const argon = screen.getByRole('button', { name: 'Gemini 4 Argon (High)' })
        expect(argon).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getAllByRole('button').indexOf(argon)).toBeLessThan(
            screen.getAllByRole('button').indexOf(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' }))
        )
        if (returnToDefault) {
            fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash (Max)' }))
            fireEvent.click(argon)
        }
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('opencode-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon',
            modelReasoningEffort: 'high'
        }))
        expect(argon).toHaveAttribute('aria-pressed', 'true')
    })

    it.each([
        { label: 'Gemini 4 Argon (High)', model: 'opencode-go/gemini-4-argon', effort: 'high' },
        { label: 'DeepSeek V4.1 Flash (Max)', model: 'opencode-go/deepseek-v4.1-flash', effort: 'max' },
    ])('pins $label to $effort despite stale remembered effort', async ({label, model, effort}) => {
        savePreferredAgent('opencode')
        savePreferredLaunchSettings('machine-1', 'opencode', {
            model: 'auto', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'low'
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'pinned-session' })
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', {name: label}))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model, modelReasoningEffort: effort
        })))
    })

    it('launches Muse with Medium by default', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariants = { 'opencode-go/muse-spark-1.3-contributor': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'muse-session' })
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' }))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'opencode-go/muse-spark-1.3-contributor', modelReasoningEffort: 'medium'
        })))
    })

    it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])('preserves the OpenCode model and explicit %s effort when continuing a session', async (selectedEffort) => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'continued-muse' })
        const source = {
            id: 'source-muse', metadata: { flavor: 'opencode', path: 'C:\\repo', host: 'desktop' },
            model: 'opencode-go/muse-spark-1.3-contributor', modelReasoningEffort: selectedEffort
        } as unknown as import('@/types/api').Session
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" continueFromSession={source} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'opencode-go/muse-spark-1.3-contributor', modelReasoningEffort: selectedEffort
        })))
    })

    it('probes current model variants once a non-default opencode effort is picked', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariants = { 'opencode-go/gemini-4-argon': ['low', 'medium', 'high'] }
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        fireEvent.click(screen.getByTestId('reasoning'))
        await waitFor(() => expect(screen.getByTestId('opencode-variants')).toHaveTextContent('low,medium,high'))
        expect(mocks.opencodeVariantsEnabled).toBe(true)
    })

    it('waits for OpenCode variants before launching a non-default effort', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariantsLoading = true
        const view = render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        fireEvent.click(screen.getByTestId('reasoning'))
        expect(screen.getByTestId('create')).toBeDisabled()

        mocks.opencodeVariantsLoading = false
        mocks.opencodeVariants = { 'opencode-go/gemini-4-argon': ['high'] }
        view.rerender(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
    })

    it('does not probe OpenCode variants until the working directory is verified', async () => {
        savePreferredAgent('opencode')
        mocks.directoryExists = undefined
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})

        expect(mocks.opencodeVariantsEnabled).toBe(false)
    })

    it('starts OpenCode on the hardcoded badge even with a remembered model', async () => {
        savePreferredAgent('opencode')
        savePreferredLaunchSettings('machine-1', 'opencode', { model: 'provider/model', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'high' })
        mocks.opencodeModels = [{ modelId: 'provider/model', name: 'Model' }]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'opencode-session' })
        render(<NewSession initialAgent="opencode" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 4 Argon (High)' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon',
            modelReasoningEffort: 'high'
        })))
    })

    it('launches AGY without saving a last-used model', async () => {
        savePreferredAgent('agy')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('agy-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: 'gemini-3.8-flash-high' }))
        expect(loadPreferredLaunchSettings('machine-1', 'agy')).toBeNull()
    })

    it('does not persist launch settings after a failed AGY launch', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'gemini-3.5-flash-low', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        mocks.agyModels = [
            { modelId: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)' },
            { modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' }
        ]
        mocks.spawnSession.mockResolvedValue({ type: 'error', message: 'spawn failed' })
        render(<NewSession initialAgent="agy" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        // The remembered model is pinned to the hardcoded default; the failed
        // launch leaves the saved preference untouched.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.notification).toHaveBeenCalledWith('error'))
        expect(loadPreferredLaunchSettings('machine-1', 'agy')?.model).toBe('gemini-3.5-flash-low')
    })

    it('spawns only once when Create is activated twice during directory validation', async () => {
        let finishDirectoryCheck!: (result: { exists: Record<string, boolean> }) => void
        mocks.checkPathsExists.mockReturnValue(new Promise((resolve) => {
            finishDirectoryCheck = resolve
        }))
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'session-1' })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        const create = screen.getByTestId('create')
        fireEvent.click(create)
        fireEvent.click(create)
        finishDirectoryCheck({ exists: { 'C:\\repo': true } })

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1', true))
        expect(mocks.checkPathsExists).toHaveBeenCalledTimes(1)
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1)
    })

    it('imports the selected Pi history and resumes the canonical HAPI session', async () => {
        savePreferredAgent('pi')
        const piApi = {
            ...api,
            getPiSessions: vi.fn().mockResolvedValue({
                success: true,
                machineId: 'machine-1',
                sessions: [{
                    id: 'pi-native-1',
                    title: 'Existing Pi session',
                    cwd: 'C:\\repo',
                    file: 'C:\\pi-native-1.jsonl',
                    modifiedAt: 1,
                    messageCount: 2
                }]
            }),
            importPiSessions: vi.fn().mockResolvedValue({
                success: true,
                machineId: 'machine-1',
                results: [{ piSessionId: 'pi-native-1', hapiSessionId: 'hapi-imported-1', action: 'created', appended: 2 }]
            }),
            reopenSession: vi.fn().mockResolvedValue({ ok: true, sessionId: 'hapi-imported-1', resumed: true })
        } as unknown as ApiClient

        render(
            <NewSession initialAgent="pi"
                api={piApi}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: 'piImport.inline.choose' }))
        await waitFor(() => expect(screen.getByTestId('select-pi-history')).toBeEnabled())
        fireEvent.click(screen.getByTestId('select-pi-history'))
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('hapi-imported-1', true))
        expect(piApi.importPiSessions).toHaveBeenCalledWith({
            sessionIds: ['pi-native-1'],
            cwd: 'C:\\repo',
            machineId: 'machine-1'
        })
        expect(piApi.reopenSession).toHaveBeenCalledWith('hapi-imported-1')
        expect(mocks.spawnSession).not.toHaveBeenCalled()
    })

    it('discards a stale Pi scan after switching machines', async () => {
        savePreferredAgent('pi')
        mocks.piDialogSelection = ['pi-machine-b']
        const machineA = { id: 'machine-a' } as Machine
        const machineB = { id: 'machine-b' } as Machine
        let resolveMachineA!: (value: Awaited<ReturnType<ApiClient['getPiSessions']>>) => void
        let resolveMachineB!: (value: Awaited<ReturnType<ApiClient['getPiSessions']>>) => void
        const machineAScan = new Promise<Awaited<ReturnType<ApiClient['getPiSessions']>>>((resolve) => {
            resolveMachineA = resolve
        })
        const machineBScan = new Promise<Awaited<ReturnType<ApiClient['getPiSessions']>>>((resolve) => {
            resolveMachineB = resolve
        })
        const piApi = {
            ...api,
            getPiSessions: vi.fn((_cwd: string | null, selectedMachineId: string) => (
                selectedMachineId === machineA.id ? machineAScan : machineBScan
            )),
            importPiSessions: vi.fn().mockResolvedValue({
                success: true,
                machineId: machineB.id,
                results: [{ piSessionId: 'pi-machine-b', hapiSessionId: 'hapi-machine-b', action: 'created', appended: 1 }]
            }),
            reopenSession: vi.fn().mockResolvedValue({ ok: true, sessionId: 'hapi-machine-b', resumed: true })
        } as unknown as ApiClient

        render(
            <NewSession initialAgent="pi"
                api={piApi}
                machines={[machineA, machineB]}
                initialMachineId={machineA.id}
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: 'piImport.inline.choose' }))
        fireEvent.click(screen.getByTestId('close-pi-history'))
        fireEvent.change(screen.getByLabelText('machine-selector'), { target: { value: machineB.id } })
        fireEvent.click(screen.getByRole('button', { name: 'piImport.inline.choose' }))
        await act(async () => {
            resolveMachineB({
                success: true,
                machineId: machineB.id,
                sessions: [{ id: 'pi-machine-b', title: 'Machine B', cwd: 'C:\\repo', file: 'B.jsonl', modifiedAt: 2, messageCount: 1 }]
            })
            await machineBScan
        })
        await waitFor(() => expect(screen.getByTestId('pi-session-ids')).toHaveTextContent('pi-machine-b'))

        await act(async () => {
            resolveMachineA({
                success: true,
                machineId: machineA.id,
                sessions: [{ id: 'pi-machine-a', title: 'Machine A', cwd: 'C:\\repo', file: 'A.jsonl', modifiedAt: 1, messageCount: 1 }]
            })
            await machineAScan
        })
        expect(screen.getByTestId('pi-session-ids')).toHaveTextContent('pi-machine-b')
        expect(screen.getByTestId('pi-session-ids')).not.toHaveTextContent('pi-machine-a')

        fireEvent.click(screen.getByTestId('select-pi-history'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('hapi-machine-b', true))
        expect(piApi.importPiSessions).toHaveBeenCalledWith({
            sessionIds: ['pi-machine-b'],
            cwd: 'C:\\repo',
            machineId: machineB.id
        })
    })

    it('refreshes successful Pi imports even when another batch item fails', async () => {
        savePreferredAgent('pi')
        mocks.piDialogSelection = ['pi-native-1', 'pi-native-2']
        const piApi = {
            ...api,
            getPiSessions: vi.fn().mockResolvedValue({
                success: true,
                machineId: 'machine-1',
                sessions: [1, 2].map((index) => ({
                    id: `pi-native-${index}`,
                    title: `Pi ${index}`,
                    cwd: 'C:\\repo',
                    file: `C:\\pi-${index}.jsonl`,
                    modifiedAt: index,
                    messageCount: 1
                }))
            }),
            importPiSessions: vi.fn().mockResolvedValue({
                success: false,
                machineId: 'machine-1',
                results: [
                    { piSessionId: 'pi-native-1', hapiSessionId: 'hapi-1', action: 'created', appended: 1 },
                    { piSessionId: 'pi-native-2', hapiSessionId: 'hapi-2', error: { code: 'session_active', message: 'active' } }
                ]
            })
        } as unknown as ApiClient

        render(
            <NewSession initialAgent="pi"
                api={piApi}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: 'piImport.inline.choose' }))
        await waitFor(() => expect(screen.getByTestId('select-pi-history')).toBeEnabled())
        fireEvent.click(screen.getByTestId('select-pi-history'))

        await waitFor(() => expect(mocks.refetchSessions).toHaveBeenCalled())
        expect(piApi.getPiSessions).toHaveBeenCalledTimes(2)
        expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'piImport.success.title',
            body: 'piImport.success.body'
        }))
        expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'piImport.failed.title' }))
    })

    it('does not save changed launch settings when creation fails', async () => {
        mocks.spawnSession.mockResolvedValue({ type: 'error', message: 'spawn failed' })

        render(
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.notification).toHaveBeenCalledWith('error'))
        expect(mocks.onSuccess).not.toHaveBeenCalled()
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
    })

    it('keeps the browse-return draft ahead of the saved launch preference', async () => {
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'gpt-5.6-sol',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'xhigh'
        })
        saveNewSessionFormDraft({
            agent: 'codex',
            model: 'gpt-5.6-terra',
            cursorSelectedBase: 'auto',
            machineId: 'machine-1',
            effort: 'auto',
            modelReasoningEffort: 'max',
            serviceTier: 'standard',
            collaborationMode: 'default',
            copilotAgentMode: 'interactive',
            yoloMode: false,
            nativePermissionMode: 'default',
            grokPermissionMode: 'default',
            sessionType: 'simple',
            worktreeName: ''
        })

        render(
            <NewSession initialAgent="claude"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            // The explicit draft model and its supported effort survive.
            expect(screen.getByRole('button', { name: 'GPT-5.6 Terra' })).toHaveAttribute('aria-pressed', 'true')
            expect(within(screen.getByRole('group', { name: 'newSession.effort' })).getByRole('button', { name: 'Max' })).toHaveAttribute('aria-pressed', 'true')
        })
    })

    it('starts Pi at Default even with a remembered model that left the catalog', async () => {
        savePreferredAgent('pi')
        mocks.piModels = [
            { provider: 'openai-codex', modelId: 'gpt-5.6-sol' },
        ]
        savePreferredLaunchSettings('machine-1', 'pi', {
            model: 'openai-codex/stale-model',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default',
        })

        render(
            <NewSession initialAgent="pi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('model')).toHaveTextContent('auto')
        })
    })

    it('resets a restored effort the Default Pi selection cannot offer', async () => {
        savePreferredAgent('pi')
        mocks.piModels = [
            {
                provider: 'openai-codex',
                modelId: 'gpt-5.6-sol',
                reasoning: true,
                thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
            },
        ]
        // Default model (auto) renders the effort field without a map, which
        // hides xhigh — the restored hidden level must not survive into create.
        savePreferredLaunchSettings('machine-1', 'pi', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'xhigh',
            modelReasoningEffort: 'default',
        })

        render(
            <NewSession initialAgent="pi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('launch-effort')).toHaveTextContent('auto')
        })
    })

    it('starts Pi at Default and drops its remembered effort when the Default map does not opt in', async () => {
        savePreferredAgent('pi')
        mocks.piModels = [
            {
                provider: 'openai-codex',
                modelId: 'gpt-5.6-sol',
                reasoning: true,
                thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
            },
        ]
        // The remembered model itself is not restored, so the effort it was
        // saved with (xhigh, map-gated) is reconciled away to auto.
        savePreferredLaunchSettings('machine-1', 'pi', {
            model: 'openai-codex/gpt-5.6-sol',
            cursorSelectedBase: 'auto',
            effort: 'xhigh',
            modelReasoningEffort: 'default',
        })

        render(
            <NewSession initialAgent="pi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('model')).toHaveTextContent('auto')
            expect(screen.getByTestId('launch-effort')).toHaveTextContent('auto')
        })
    })

    it('does not submit a hidden restored effort when Pi model discovery fails', async () => {
        savePreferredAgent('pi')
        // A failed catalog never resolves the restored model, so the effort
        // field renders with an undefined map and hides xhigh. Creation is not
        // blocked on error (only on loading), so the hidden level must have
        // been reconciled away rather than forwarded.
        mocks.piModels = []
        mocks.piModelsError = 'probe failed'
        savePreferredLaunchSettings('machine-1', 'pi', {
            model: 'openai-codex/gpt-5.6-sol',
            cursorSelectedBase: 'auto',
            effort: 'xhigh',
            modelReasoningEffort: 'default',
        })

        render(
            <NewSession initialAgent="pi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            expect(screen.getByTestId('launch-effort')).toHaveTextContent('auto')
        })

        act(() => {
            mocks.spawnSession.mockImplementation(async () => ({ type: 'success', sessionId: 'session-1' }))
        })
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'pi',
            effort: undefined,
        }))
    })

    it('shows Pi machine models and thinking-level effort and forwards both on create', async () => {
        savePreferredAgent('pi')
        mocks.piModels = [
            { provider: 'openai-codex', modelId: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
            { provider: 'opencode-go', modelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        ]

        render(
            <NewSession initialAgent="pi"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        await waitFor(() => {
            // Provider-qualified options surfaced through the unified ModelSelector.
            expect(screen.getByTestId('model-options')).toHaveTextContent('GPT-5.6 Sol')
            expect(screen.getByTestId('model-options')).toHaveTextContent('DeepSeek V4 Pro')
        })

        // Select the second provider's model and a thinking level.
        act(() => {
            mocks.spawnSession.mockImplementation(async () => ({ type: 'success', sessionId: 'session-1' }))
        })
        mocks.nextModelValue = 'opencode-go/deepseek-v4-pro'
        fireEvent.click(screen.getByTestId('model'))
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'pi',
            model: 'opencode-go/deepseek-v4-pro',
        }))
    })

    it('reuses source settings and sends its reference when continuing in another folder', async () => {
        savePreferredAgent('claude')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'continued-session' })
        const continueFromSession = {
            id: '8d534fba-33d6-4ce4-9d96-64e9e38d61da',
            metadata: {
                path: 'C:\\code',
                host: 'desktop',
                name: 'HAPI interface work',
                flavor: 'codex',
                preferredPermissionMode: 'yolo',
            },
            model: 'gpt-5.6-sol',
            modelReasoningEffort: 'high',
            effort: null,
            serviceTier: 'fast',
            permissionMode: 'yolo',
            collaborationMode: 'default',
        } as unknown as import('@/types/api').Session

        render(
            <NewSession initialAgent="claude"
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                continueFromSession={continueFromSession}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )
        await act(async () => {})

        expect(screen.getByText('newSession.continue.description')).toBeInTheDocument()
        await waitFor(() => expect(screen.getByDisplayValue('all')).toBeChecked())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('continued-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'codex',
            model: 'gpt-5.6-sol',
            modelReasoningEffort: 'high',
            permissionMode: 'yolo',
        }))
        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'continued-session',
            expect.stringContaining('/sessions/8d534fba-33d6-4ce4-9d96-64e9e38d61da'),
            expect.stringMatching(/^local-/)
        )
    })
})

describe('NewSession GLM-branded claude', () => {
    beforeEach(() => {
        mocks.narrowViewport = false
        mocks.popularModels = []
        mocks.codexModelsError = null
        mocks.codexTerraName = 'GPT-6.1 Terra'
        mocks.codexDefaultModelId = 'gpt-6.1-sol'
        mocks.cursorModelsError = null
        mocks.cursorCurrentModelId = null
        mocks.useRealCatalogHooks = false
        localStorage.clear()
        sessionStorage.clear()
        mocks.spawnSession.mockReset()
        mocks.onSuccess.mockReset()
        mocks.notification.mockReset()
        mocks.checkPathsExists.mockReset()
        mocks.checkPathsExists.mockImplementation(async () => ({
            exists: { 'C:\\repo': true }
        }))
        setClaudeGlmBranded(true)
    })

    afterEach(() => {
        setClaudeGlmBranded(false)
    })

    it.each([false, true])('launches explicit GLM 5.3, returning to Flash: %s', async (returnToFlash) => {
        savePreferredAgent('claude')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'GLM 5.3 Flash' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'GLM 5.3' })).toHaveAttribute('aria-pressed', 'true'))
        if (returnToFlash) fireEvent.click(screen.getByRole('button', { name: 'GLM 5.3 Flash' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude', model: returnToFlash ? undefined : 'glm-5.3'
        })))
    })

    it('hides the effort field and never passes the remembered effort', async () => {
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'claude', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default'
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})

        // GLM serves no effort levels, so the field is gone and a value
        // remembered from a pre-branding launch cannot leak into the spawn.
        expect(screen.queryByTestId('launch-effort')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            effort: undefined
        }))
    })
})

describe('NewSession fork launch defaults', () => {
    beforeEach(() => {
        mocks.modelPreferences = []
        mocks.narrowViewport = false
        mocks.popularModels = []
        mocks.codexModelsError = null
        mocks.codexTerraName = 'GPT-6.1 Terra'
        mocks.codexDefaultModelId = 'gpt-6.1-sol'
        mocks.cursorModelsError = null
        mocks.cursorCurrentModelId = null
        mocks.useRealCatalogHooks = false
        localStorage.clear()
        sessionStorage.clear()
        mocks.spawnSession.mockReset()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'fork-session' })
        mocks.onSuccess.mockReset()
        mocks.notification.mockReset()
        mocks.checkPathsExists.mockReset()
        mocks.checkPathsExists.mockImplementation(async () => ({
            exists: { 'C:\\repo': true }
        }))
        mocks.availableAgents.splice(
            0,
            mocks.availableAgents.length,
            ...['agy', 'claude', 'codex', 'dsh', 'copilot', 'cursor', 'grok', 'kimi', 'opencode', 'pi']
                .map((agent) => ({ agent, available: true, defaultModelName: undefined }))
        )
        mocks.cursorModels = [{ modelId: 'composer-2.5' }, { modelId: 'grok-4.7-xhigh' }]
        mocks.cursorSkus = [{ modelId: 'composer-2.5-fast' }, { modelId: 'grok-4.7-xhigh-fast' }]
        mocks.cursorModelsLoading = false
        mocks.agyModels = [{ modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' }]
        savePreferredAgent('codex')
    })

    it('lands a fresh Claude form on its YOLO-equivalent despite a remembered Default', async () => {
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'claude', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'default',
            permissionMode: 'default'
        })
        render(<NewSession initialAgent="claude" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})

        // Fork: remembered permission modes no longer pin the form; every
        // fresh launch opens on the flavor's own YOLO-equivalent.
        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'bypassPermissions' })))
    })

    it('lands a fresh Codex form on YOLO with no stored preference', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'codex-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' })))
    })

    it.each(['standard', 'fast'] as const)('submits the selected Codex %s badge', async (serviceTier) => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'speed-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})

        expect(screen.queryByText('newSession.collaborationMode')).toBeNull()
        expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        if (serviceTier === 'standard') fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeStandard' }))
        expect(screen.getByRole('button', { name: serviceTier === 'fast' ? 'misc.fastModeFast' : 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra', modelReasoningEffort: undefined, serviceTier, permissionMode: 'yolo' })))
    })

    it('uses Codex default for GPT-6.1 Sol after switching through Terra and GPT-6 Sol', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Sol' }))
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        expect(within(screen.getByRole('group', { name: 'newSession.effort' })).queryByRole('button', { pressed: true })).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-sol', modelReasoningEffort: undefined, serviceTier: 'fast' })))
    })

    it('launches GPT-6 Sol with Medium after selecting the second badge', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Sol' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6-sol', modelReasoningEffort: undefined, serviceTier: 'fast' })))
    })

    it('uses each saved model effort and allows a one-launch override', async () => {
        mocks.modelPreferences = [
            { agent: 'codex', modelId: 'gpt-6.1-terra', pinned: true, alias: 'Work', reasoningEffort: 'high' },
            { agent: 'codex', modelId: 'gpt-6.1-sol', pinned: true, alias: null, reasoningEffort: 'low' }
        ]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'Work' })).toBeVisible())
        const effort = screen.getByRole('group', { name: 'newSession.effort' })
        expect(within(effort).getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        expect(within(effort).getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(effort).getByRole('button', { name: 'High' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-sol', modelReasoningEffort: 'high' })))
    })

    it('launches the explicitly selected Codex effort', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        const effort = screen.getByRole('group', { name: 'newSession.effort' })
        fireEvent.click(within(effort).getByRole('button', { name: 'High' }))
        expect(within(effort).getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra', modelReasoningEffort: 'high', serviceTier: 'fast' })))
    })

    it('keeps Terra Medium while Standard speed is chosen manually', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeStandard' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra', modelReasoningEffort: undefined, serviceTier: 'standard' })))
    })

    it('ignores the previously used Codex model and speed', async () => {
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'gpt-6.1-sol', cursorSelectedBase: 'auto', effort: 'auto',
            modelReasoningEffort: 'low', serviceTier: 'standard'
        })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        expect(within(screen.getByRole('group', { name: 'newSession.effort' })).queryByRole('button', { pressed: true })).toBeNull()
        expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra', modelReasoningEffort: undefined, serviceTier: 'fast' })))
    })

    it('falls back to GPT-6.1 Terra when a remembered Codex model leaves the catalog', async () => {
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'retired-model', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default'
        })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        await waitFor(() => expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6.1-terra', modelReasoningEffort: undefined, serviceTier: 'fast' })))
    })

    it('does not restore the removed Astra quick pick', async () => {
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'gpt-6-astra', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default'
        })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByRole('button', { name: 'GPT-6 Astra' })).toBeNull()
    })

    it('drops Fast when switching to a Codex model without a fast tier', async () => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'standard-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        expect(screen.queryByRole('button', { name: 'misc.fastModeFast' })).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6-luna', serviceTier: undefined })))
    })

    it.each([
        { label: 'Grok 4.7 Extra High', model: 'grok-4.7-xhigh-fast', speed: 'fast' },
        { label: 'Grok 4.7 Extra High', model: 'grok-4.7-xhigh', speed: 'standard' },
        { label: 'Composer 2.5', model: 'composer-2.5-fast', speed: 'fast' },
        { label: 'Composer 2.5', model: 'composer-2.5', speed: 'standard' },
    ])('launches Cursor $label with $speed and YOLO', async ({ label, model, speed }) => {
        savePreferredAgent('cursor')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'fork-session' })
        render(<NewSession initialAgent="cursor" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        await act(async () => {})

        fireEvent.click(screen.getByRole('button', { name: label }))
        expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        if (speed === 'fast') fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        expect(screen.queryByText('newSession.yolo')).toBeNull()

        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('fork-session', true))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model, yolo: true, serviceTier: undefined }))
    })


    it('keeps a restored Cursor effort when enabling advertised Fast', async () => {
        savePreferredAgent('cursor')
        mocks.cursorModels = [{ modelId: 'grok-4.7-high' }]
        mocks.cursorSkus = [{ modelId: 'grok-4.7-high-fast' }]
        saveNewSessionFormDraft({
            agent: 'cursor', model: 'grok-4.7-high', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'yolo',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        render(<NewSession initialAgent="cursor" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'grok-4.7-high-fast' })))
    })

    it('uses All agents as a filter and launches the explicitly selected executor/model without carrying Fast', async () => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'pair-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('radio', { name: 'newSession.allAgents' })).toBeChecked()
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByRole('button', { name: 'Composer 2.5' }))
        expect(screen.getByRole('radio', { name: 'newSession.allAgents' })).toBeChecked()
        expect(screen.getByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('radio', { name: 'Cursor' }))
        expect(screen.queryByRole('button', { name: 'GPT-6 Luna' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.getByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'composer-2.5', serviceTier: undefined })))
    })

    it('keeps the create-page Codex default independent of the CLI catalog default', async () => {
        mocks.codexDefaultModelId = 'gpt-6-luna'
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6.1-terra', modelReasoningEffort: undefined, serviceTier: 'fast' })))
    })

    it.each(['codex', 'minimax'] as const)('distinguishes identical model labels by executor and launches %s', async agent => {
        mocks.availableAgents.push({ agent: 'minimax', available: true, defaultModelName: 'GPT-6 Luna' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.getAllByRole('button', { name: 'GPT-6 Luna' })).toHaveLength(2)
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna', description: agent === 'codex' ? 'Codex' : 'MiniMax Code' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent, model: agent === 'codex' ? 'gpt-6-luna' : undefined, serviceTier: undefined })))
    })

    it('maps the verbose Cursor default onto Grok and keeps Standard/Fast', async () => {
        savePreferredAgent('cursor')
        mocks.availableAgents.find((entry) => entry.agent === 'cursor')!.defaultModelName = 'Grok 4.7 256K Extra High Fast'
        mocks.cursorCurrentModelId = 'grok-4.7[fast=true,reasoning_effort=xhigh]'
        mocks.cursorModels = [{ modelId: 'grok-4.7' }, { modelId: 'composer-2.5' }]
        mocks.cursorSkus = [{ modelId: 'grok-4.7-xhigh' }, { modelId: 'grok-4.7-xhigh-fast' }, { modelId: 'composer-2.5' }, { modelId: 'composer-2.5-fast' }]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'cursor-session' })
        render(<NewSession initialAgent="cursor" api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('radio', { name: 'Cursor' }))

        const grok = screen.getByRole('button', { name: 'Grok 4.7 Extra High' })
        expect(grok).toHaveAttribute('aria-pressed', 'true')
        expect(grok).toHaveTextContent('Grok 4.7')
        expect(grok).not.toHaveTextContent('256')
        expect(grok.querySelector('svg')).toBeNull()
        expect(screen.queryByRole('button', { name: /256/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'misc.fastModeFast' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeStandard' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'cursor', model: 'grok-4.7-xhigh', serviceTier: undefined
        })))
    })

    it('hides Cursor Speed without an advertised fast counterpart and launches the standard wire', async () => {
        mocks.cursorModels = [{ modelId: 'composer-2.5' }]
        mocks.cursorSkus = []
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'Composer 2.5' }))
        expect(screen.queryByRole('button', { name: 'misc.fastModeFast' })).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'composer-2.5', serviceTier: undefined })))
    })

    it('uses advertised ACP speed wires without changing the selected model', async () => {
        mocks.cursorModels = [{ modelId: 'composer-2.5[fast=false]' }, { modelId: 'composer-2.5[fast=true]' }]
        mocks.cursorSkus = []
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'Composer 2.5' }))
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        expect(screen.getByRole('button', { name: 'Composer 2.5' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'composer-2.5[fast=true]' })))
    })

    it('resets to Cursor native settings when filtering from Codex even if discovery fails', async () => {
        mocks.cursorModelsError = 'Discovery unavailable'
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6.1 Sol' }))
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByRole('radio', { name: 'Cursor' }))
        expect(screen.queryByRole('button', { name: 'misc.fastModeFast' })).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: undefined, serviceTier: undefined })))
    })

    it.each([true, false])('orders model groups by agent regardless of usage (MiniMax available: %s)', async minimaxAvailable => {
        setClaudeGlmBranded(true)
        mocks.availableAgents.push({ agent: 'minimax', available: minimaxAvailable, defaultModelName: 'MiniMax M3.1-Flash-Preview' })
        mocks.popularModels = [
            { agent: 'cursor', model: 'composer-2.5', sessionCount: 20, lastUsedAt: 200 },
            { agent: 'opencode', model: 'opencode-go/muse-spark-1.3-contributor', sessionCount: 10, lastUsedAt: 300 },
        ]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        const choices = screen.getByRole('region', { name: 'newSession.model' })
        expect(within(choices).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['GPT-6.1 Terra', 'GPT-6 Sol', 'GPT-6.1 Sol', 'GPT-6 Luna', 'GLM 5.3 Flash', 'GLM 5.3', 'Gemini 3.8 Flash (High)', 'Gemini 3.6 Flash', 'Gemini 4 Argon (High)', 'Muse Spark 1.3 (Medium)', 'DeepSeek V4.1 Flash (Max)', 'Grok 4.7 Extra High', 'Composer 2.5', ...(minimaxAvailable ? ['MiniMax M3.1-Flash-Preview'] : [])])
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6.1 Terra' }).querySelector('svg')).not.toBeNull()
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toBeVisible()
        if (minimaxAvailable) {
            fireEvent.click(screen.getByRole('button', { name: 'MiniMax M3.1-Flash-Preview' }))
            expect(screen.getByRole('button', { name: 'MiniMax M3.1-Flash-Preview' })).toHaveAttribute('aria-pressed', 'true')
            expect(within(choices).getAllByRole('button')[0]).toHaveAttribute('aria-label', 'GPT-6.1 Terra')
        }
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' }).querySelector('svg')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByRole('radio', { name: 'newSession.allAgents' }))
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toBeVisible()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', model: 'gpt-6-luna' })))
    })

    it('shows configured choices on mobile with no selected filter, supports clearing an agent and preserves the launched pair', async () => {
        mocks.directoryExists = true
        mocks.opencodeModelsLoading = false
        mocks.opencodeVariantsLoading = false
        mocks.narrowViewport = true
        mocks.popularModels = [
            { agent: 'codex', model: 'gpt-6.1-sol', sessionCount: 20, lastUsedAt: 200 },
            { agent: 'opencode', model: 'opencode-go/muse-spark-1.3-contributor', sessionCount: 10, lastUsedAt: 300 },
        ]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await act(async () => {})
        expect(screen.queryByLabelText('newSession.allAgents')).toBeNull()
        expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true)
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).not.toHaveTextContent('(Medium)')
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toBeVisible()
        fireEvent.click(screen.getByRole('radio', { name: 'OpenCode' }))
        expect(screen.getByRole('radio', { name: 'OpenCode' })).toBeChecked()
        expect(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash (Max)' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'GPT-6.1 Sol' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' }))
        fireEvent.click(screen.getByRole('radio', { name: 'OpenCode' }))
        expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true)
        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3 (Medium)' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'opencode', model: 'opencode-go/muse-spark-1.3-contributor', modelReasoningEffort: 'medium', serviceTier: undefined })))
    })

})
