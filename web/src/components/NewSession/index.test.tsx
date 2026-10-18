import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine, PiModelSummary } from '@/types/api'
import { setClaudeGlmBranded } from '@/lib/claudeGlmBranding'
import { saveNewSessionFormDraft } from './newSessionFormDraft'
import {
    loadPreferredLaunchSettings,
    savePreferredAgent,
    savePreferredLaunchSettings,
    savePreferredYoloMode
} from './preferences'

const mocks = vi.hoisted(() => ({
    useRealCatalogHooks: false,
    spawnSession: vi.fn(),
    sendMessage: vi.fn(),
    onSuccess: vi.fn(),
    notification: vi.fn(),
    checkPathsExists: vi.fn(),
    availableAgents: [
        'agy', 'claude', 'codex', 'dsh', 'copilot', 'cursor', 'grok', 'kimi', 'opencode', 'pi'
    ].map((agent) => ({ agent, available: true, defaultModelName: undefined as string | undefined })),
    codexModelsLoading: false,
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
    opencodeVariants: null as Record<string, string[]> | null,
    opencodeVariantsLoading: false,
    opencodeVariantsEnabled: false,
    piDialogSelection: ['pi-native-1'] as string[],
    cursorModels: [] as Array<{ modelId: string; name?: string }>,
    cursorSkus: [] as Array<{ modelId: string; name?: string }>,
    cursorModelsLoading: false,
    piModels: [] as PiModelSummary[],
    piModelsLoading: false,
    piModelsError: null as string | null,
    piCurrentModelId: null as string | null,
    nextModelValue: 'gpt-5.6-terra',
    refetchSessions: vi.fn(),
    addToast: vi.fn()
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))
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
vi.mock('@/hooks/queries/useCodexModels', () => ({
    useCodexModels: () => ({
        models: [
            {
                id: 'gpt-6.1-sol',
                displayName: 'GPT-6.1-Sol',
                isDefault: true,
                supportedReasoningEfforts: ['low', 'high', 'xhigh'],
                serviceTiers: ['priority', 'fast']
            },
            {
                id: 'gpt-6-luna',
                displayName: 'GPT-6-Luna',
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
        ],
        isLoading: mocks.codexModelsLoading,
        error: null
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
            currentModelId: null,
            isLoading: mocks.cursorModelsLoading,
            error: null,
            refetch: vi.fn()
        })
    }
})
vi.mock('@/hooks/queries/useOpencodeModelsForCwd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/queries/useOpencodeModelsForCwd')>()
    return {
        useOpencodeModelsForCwd: (args: Parameters<typeof actual.useOpencodeModelsForCwd>[0]) => mocks.useRealCatalogHooks ? actual.useOpencodeModelsForCwd(args) : ({
            availableModels: mocks.opencodeModels,
            currentModelId: mocks.opencodeCurrentModelId,
            isLoading: mocks.opencodeModelsLoading,
            error: null,
            refetch: vi.fn()
        })
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
vi.mock('./DirectorySection', () => ({ DirectorySection: () => null }))
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
    EffortField: (props: { agent: string; effort: string; reasoningEffort: string; opencodeVariantOptions?: string[] | null; onReasoningEffortChange: (v: string) => void }) => (
        <>
            <div data-testid="launch-effort">{props.effort}</div>
            <div data-testid="opencode-variants">{props.opencodeVariantOptions?.join(',') ?? 'static'}</div>
            <button type="button" data-testid="reasoning" onClick={() => props.onReasoningEffortChange(props.agent === 'opencode' ? 'high' : 'max')}>
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
    ActionButtons: (props: { onCreate: () => void; onChooseFolder?: () => void; canCreate: boolean }) => (
        <>
            <button type="button" data-testid="create" disabled={!props.canCreate} onClick={props.onCreate}>create</button>
            {props.onChooseFolder ? <button type="button" data-testid="browse" onClick={props.onChooseFolder}>browse</button> : null}
        </>
    )
}))

import { NewSession } from './index'

const machine = { id: 'machine-1' } as Machine
const api = { sendMessage: mocks.sendMessage } as unknown as ApiClient

describe('NewSession launch preferences', () => {
    beforeEach(() => {
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
        savePreferredAgent('codex')
    })

    it('creates an optional named group and reuses its request after a failed launch', async () => {
        const createGroup = vi.fn(async () => ({ group: { id: 'created-group', name: 'HAPI' } }))
        mocks.spawnSession.mockRejectedValueOnce(new Error('Runner unavailable')).mockResolvedValueOnce({ type: 'success', sessionId: 'new-chat' })
        render(<NewSession api={{ ...api, createGroup } as unknown as ApiClient} machines={[machine]} initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.queryByRole('textbox', { name: 'groups.name' })).toBeNull()
        fireEvent.click(screen.getByRole('checkbox', { name: 'groups.createWithChat' }))
        expect(screen.getByTestId('create')).toBeDisabled()
        fireEvent.change(screen.getByRole('textbox', { name: 'groups.name' }), { target: { value: '  HAPI  ' } })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('new-chat'))
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
        expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked()
        expect(screen.queryByRole('checkbox', { name: 'groups.createWithChat' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Claude' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group', agent: 'claude', directory: 'C:\\repo' })))
    })

    it('falls back to an available group agent with an explanation', async () => {
        mocks.availableAgents = mocks.availableAgents.filter(entry => entry.agent !== 'claude')
        render(<NewSession api={api} machines={[machine]} groupId="group" initialAgent="claude" initialMachineId="machine-1" initialDirectory={'C:\\repo'} onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked())
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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        await waitFor(() => expect(screen.getByDisplayValue('codex')).toBeChecked())
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

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(screen.getByText('newSession.directoryOutsideWorkspaceRoots')).toBeInTheDocument())
        expect(mocks.spawnSession).not.toHaveBeenCalled()
    })

    it('pins codex to the hardcoded GPT-6.1-Sol badge with Default reasoning effort, keeping saved permission', async () => {
        savePreferredLaunchSettings('machine-1', 'codex', {
            model: 'gpt-5.6-sol',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'xhigh',
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

        await waitFor(() => {
            // A remembered non-shortlist model is coerced to the hardcoded
            // default; the remembered effort still resets to Default.
            expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'true')
            expect(screen.getByTestId('reasoning')).toHaveTextContent('default')
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.getByTestId('model-options').textContent).toBe('Native model')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent, model: undefined })))
    })

    it('names the codex hardcoded badges, with GPT-6.1-Sol pressed', () => {
        // No dropdown: codex always offers the hardcoded shortlist and opens
        // on GPT-6.1-Sol.
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

        expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'GPT-6 Astra' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.queryByTestId('model')).toBeNull()
    })

    it('reveals the full codex catalog behind the load-other-models hatch', async () => {
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

        expect(screen.queryByTestId('model')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(screen.getByTestId('model-options')).toHaveTextContent('GPT-6.1-Sol'))
    })

    it('shows the minimax native default as a badge without pinning it at launch', async () => {
        savePreferredAgent('minimax')
        mocks.availableAgents.push({ agent: 'minimax', available: true, defaultModelName: 'Native model' })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'native-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.getByRole('button', { name: 'MiniMax M3.1 Flash' })).toBeInTheDocument()
        expect(screen.queryByTestId('model')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'minimax', model: undefined })))
    })

    it('uses the new Codex YOLO default independently of another agent legacy value', async () => {
        savePreferredAgent('claude')
        savePreferredYoloMode(true)

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory={'C:\\repo'}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory={'C:\\repo'}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model')).toHaveTextContent('auto')
        })
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it('ignores a remembered codex reasoning effort instead of validating it', async () => {
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

        await waitFor(() => expect(screen.getByTestId('reasoning')).toHaveTextContent('default'))
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it.each([
        ['grok', {
            model: 'grok-4',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default'
        }],
        ['opencode', {
            model: 'provider/model',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'high'
        }]
    ] as const)('disables creation while %s cwd existence is unresolved', async (
        agent,
        settings
    ) => {
        mocks.directoryExists = undefined
        savePreferredAgent(agent)
        savePreferredLaunchSettings('machine-1', agent, settings)

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

        await waitFor(() => expect(screen.getByTestId('create')).toBeDisabled())
    })

    it('saves changed launch settings only after creation succeeds', async () => {
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

        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByTestId('reasoning'))
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' }))
        expect(loadPreferredLaunchSettings('machine-1', 'codex')).toEqual({
            model: 'gpt-6-luna',
            cursorSelectedBase: 'auto',
            effort: 'auto',
            modelReasoningEffort: 'max',
            permissionMode: 'yolo'
        })
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.queryByRole('button', { name: 'Claude Opus 4.6 (Thinking)' })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
    })

    it.each(['gemini-3.6-flash-low', 'gemini-3.8-flash-high'])('restores only shortlisted AGY models from a browse-return draft: %s', async (draftModel) => {
        savePreferredAgent('agy')
        saveNewSessionFormDraft({
            agent: 'agy', model: draftModel, cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: draftModel === 'gemini-3.8-flash-high' ? draftModel : undefined })))
    })

    it('keeps the hardcoded AGY badge when a browse-return draft names an unadvertised model', async () => {
        savePreferredAgent('agy')
        saveNewSessionFormDraft({
            agent: 'agy', model: 'removed-model', cursorSelectedBase: 'auto', machineId: 'machine-1',
            effort: 'auto', modelReasoningEffort: 'default', serviceTier: 'standard', collaborationMode: 'default',
            copilotAgentMode: 'interactive', yoloMode: false, nativePermissionMode: 'default',
            grokPermissionMode: 'default', sessionType: 'simple', worktreeName: ''
        })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
    })

    it('keeps the hardcoded AGY badge when the machine catalog changes under the form', async () => {
        // The machine refreshes its catalog in the background; the hardcoded
        // badge does not depend on it, so it never flickers or resets.
        savePreferredAgent('agy')
        const view = render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())

        mocks.agyModels = [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }]
        view.rerender(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
    })

    it('pins the hardcoded AGY badge even with a remembered model, without blocking creation', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'removed-model', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
    })

    it('starts AGY at the hardcoded default even with a remembered model', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'gemini-3.6-flash-low', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        mocks.agyModelsLoading = true
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        // Default needs no catalog validation, so creation is not blocked.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
        expect(screen.getByTestId('create')).toBeEnabled()
    })

    it.each([false, true])('launches the AGY High badge, returning to Medium: %s', async (returnToMedium) => {
        savePreferredAgent('agy')
        mocks.agyModelsLoading = true
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (High)' })).toHaveAttribute('aria-pressed', 'true'))
        if (returnToMedium) fireEvent.click(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' }))
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'agy', model: returnToMedium ? undefined : 'gemini-3.8-flash-high'
        })))
    })

    it('reveals the full AGY catalog behind the load-other-models hatch', async () => {
        savePreferredAgent('agy')
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.queryByTestId('agy-model')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(screen.getByTestId('agy-model')).toBeInTheDocument())
    })

    it('does not forward the global YOLO preference to managed DSH ACP', async () => {
        savePreferredAgent('dsh')
        savePreferredYoloMode(true)
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'dsh-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('dsh-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'dsh',
            yolo: undefined,
            permissionMode: undefined
        }))
    })

    it('launches Claude with its native YOLO mode while the permission field is hidden', async () => {
        savePreferredAgent('claude')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            yolo: undefined,
            permissionMode: 'bypassPermissions'
        }))
    })

    it('uses Claude permissions after switching from Codex', async () => {
        savePreferredAgent('codex')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        // Switching flavors keeps each agent's own YOLO-equivalent launch mode.
        await waitFor(() => expect(screen.getByDisplayValue('codex')).toBeChecked())
        fireEvent.click(screen.getByDisplayValue('claude'))
        await waitFor(() => expect(screen.getByDisplayValue('claude')).toBeChecked())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            permissionMode: 'bypassPermissions'
        }))
    })

    it('migrates a legacy YOLO value owned by Claude to bypassPermissions', async () => {
        savePreferredAgent('claude')
        savePreferredYoloMode(true)

        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

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

        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        await waitFor(() => expect(screen.getByDisplayValue('cursor')).toBeChecked())
        fireEvent.click(screen.getByDisplayValue('claude'))

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'permission-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'bypassPermissions' })))
    })

    it('keeps the effort field and passes the remembered effort while claude is not GLM-branded', async () => {
        savePreferredAgent('claude')
        savePreferredLaunchSettings('machine-1', 'claude', {
            model: 'auto',
            cursorSelectedBase: 'auto',
            effort: 'high',
            modelReasoningEffort: 'default'
        })
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        expect(screen.getByTestId('launch-effort')).toHaveTextContent('high')
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            effort: 'high'
        }))
    })

    it('launches cursor badges with the full picker behind the hatch', async () => {
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
            <NewSession api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)

        // Badges pin Grok Extra High regardless of the remembered model.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Grok 4.7 Extra High' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(screen.getAllByTestId('model-options')[0].textContent).toContain('grok-4.7'))
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'grok-4.7-xhigh' })))
        view.unmount()
        client.clear()
    })

    it('launches opencode Default without a catalog request, even while an explicit catalog load is pending', async () => {
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
            <NewSession api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        expect(getMachineCursorModels.mock.calls.length + getMachineOpencodeModelsForCwd.mock.calls.length).toBe(0)
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(getMachineOpencodeModelsForCwd).toHaveBeenCalledTimes(1))
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        expect(screen.getByTestId('create')).toBeEnabled()
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon-contributor',
            modelReasoningEffort: 'high'
        })))
        view.unmount()
        client.clear()
    })

    it('launches opencode with the hardcoded badge and never requests the model catalog', async () => {
        mocks.useRealCatalogHooks = true
        savePreferredAgent('opencode')
        const getMachineOpencodeModelsForCwd = vi.fn(() => new Promise(() => {}))
        const getMachineOpencodeModelVariants = vi.fn()
        const catalogApi = { ...api, getMachineOpencodeModelsForCwd, getMachineOpencodeModelVariants } as unknown as ApiClient
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'default-session' })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = render(<QueryClientProvider client={client}>
            <NewSession api={catalogApi} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />
        </QueryClientProvider>)

        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3' })).toBeInTheDocument()
        // No dropdown: the catalog is never requested unless the hatch opens it.
        expect(getMachineOpencodeModelsForCwd.mock.calls.length).toBe(0)
        expect(getMachineOpencodeModelVariants.mock.calls.length).toBe(0)
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon-contributor',
            modelReasoningEffort: 'high'
        })))
        view.unmount()
        client.clear()
    })

    it('launches an explicitly selected opencode catalog model while keeping the quick picks available', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeModels = [{ modelId: 'provider/model', name: 'Other model' }]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'catalog-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        expect(screen.queryByTestId('opencode-model')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(screen.getByTestId('opencode-model')).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('opencode-model-pick'))
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3' })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash' })).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'provider/model'
        })))
    })

    it('launches DeepSeek V4.1 Flash from the quick pick even when the discovered catalog omits it', async () => {
        savePreferredAgent('opencode')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'deepseek-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash' })).toHaveAttribute('aria-pressed', 'true'))
        expect(screen.getByRole('button', { name: 'Muse Spark 1.3' })).toHaveAttribute('aria-pressed', 'false')
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode', model: 'opencode-go/deepseek-v4.1-flash'
        })))
    })

    it.each([false, true])('launches Gemini 4 Argon at high effort when returning to its default badge: %s', async (returnToDefault) => {
        savePreferredAgent('opencode')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'opencode-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        const argon = screen.getByRole('button', { name: 'Gemini 4 Argon' })
        expect(argon).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getAllByRole('button').indexOf(argon)).toBeLessThan(
            screen.getAllByRole('button').indexOf(screen.getByRole('button', { name: 'Muse Spark 1.3' }))
        )
        if (returnToDefault) {
            fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4.1 Flash' }))
            fireEvent.click(argon)
        }
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('opencode-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon-contributor',
            modelReasoningEffort: 'high'
        }))
        expect(argon).toHaveAttribute('aria-pressed', 'true')
    })

    it('probes current model variants once a non-default opencode effort is picked', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariants = { 'opencode-go/gemini-4-argon-contributor': ['low', 'medium', 'high'] }
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        fireEvent.click(screen.getByTestId('reasoning'))
        await waitFor(() => expect(screen.getByTestId('opencode-variants')).toHaveTextContent('low,medium,high'))
        expect(mocks.opencodeVariantsEnabled).toBe(true)
    })

    it('waits for OpenCode variants before launching a non-default effort', async () => {
        savePreferredAgent('opencode')
        mocks.opencodeVariantsLoading = true
        const view = render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        fireEvent.click(screen.getByTestId('reasoning'))
        expect(screen.getByTestId('create')).toBeDisabled()

        mocks.opencodeVariantsLoading = false
        mocks.opencodeVariants = { 'opencode-go/gemini-4-argon-contributor': ['high'] }
        view.rerender(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByTestId('create')).toBeEnabled())
    })

    it('does not probe OpenCode variants until the working directory is verified', () => {
        savePreferredAgent('opencode')
        mocks.directoryExists = undefined
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        expect(mocks.opencodeVariantsEnabled).toBe(false)
    })

    it('starts OpenCode on the hardcoded badge even with a remembered model', async () => {
        savePreferredAgent('opencode')
        savePreferredLaunchSettings('machine-1', 'opencode', { model: 'provider/model', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'high' })
        mocks.opencodeModels = [{ modelId: 'provider/model', name: 'Model' }]
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'opencode-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 4 Argon' })).toHaveAttribute('aria-pressed', 'true'))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'opencode',
            model: 'opencode-go/gemini-4-argon-contributor',
            modelReasoningEffort: 'high'
        })))
    })

    it('launches AGY with the backend default and saves auto only after a successful launch', async () => {
        savePreferredAgent('agy')
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'agy-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('agy-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agy', model: undefined }))
        expect(loadPreferredLaunchSettings('machine-1', 'agy')?.model).toBe('auto')
    })

    it('does not persist launch settings after a failed AGY launch', async () => {
        savePreferredAgent('agy')
        savePreferredLaunchSettings('machine-1', 'agy', { model: 'gemini-3.5-flash-low', cursorSelectedBase: 'auto', effort: 'auto', modelReasoningEffort: 'default' })
        mocks.agyModels = [
            { modelId: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)' },
            { modelId: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' }
        ]
        mocks.spawnSession.mockResolvedValue({ type: 'error', message: 'spawn failed' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
        // The remembered model is pinned to the hardcoded default; the failed
        // launch leaves the saved preference untouched.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Medium)' })).toBeInTheDocument())
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

        const create = screen.getByTestId('create')
        fireEvent.click(create)
        fireEvent.click(create)
        finishDirectoryCheck({ exists: { 'C:\\repo': true } })

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1'))
        expect(mocks.checkPathsExists).toHaveBeenCalledTimes(1)
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1)
    })

    it('imports the selected Pi history and resumes the canonical HAPI session', async () => {
        savePreferredAgent('pi')
        const piApi = {
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
            <NewSession
                api={piApi}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'piImport.inline.choose' }))
        await waitFor(() => expect(screen.getByTestId('select-pi-history')).toBeEnabled())
        fireEvent.click(screen.getByTestId('select-pi-history'))
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('hapi-imported-1'))
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
            <NewSession
                api={piApi}
                machines={[machineA, machineB]}
                initialMachineId={machineA.id}
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('hapi-machine-b'))
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
            <NewSession
                api={piApi}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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

        fireEvent.click(screen.getByRole('button', { name: 'GPT-6 Luna' }))
        fireEvent.click(screen.getByTestId('reasoning'))
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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        await waitFor(() => {
            // A codex draft model outside the hardcoded shortlist is coerced
            // to GPT-6.1-Sol, and a draft reasoning effort is clamped to
            // Default like any other remembered value.
            expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toHaveAttribute('aria-pressed', 'true')
            expect(screen.getByTestId('reasoning')).toHaveTextContent('default')
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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('launch-effort')).toHaveTextContent('auto')
        })

        act(() => {
            mocks.spawnSession.mockImplementation(async () => ({ type: 'success', sessionId: 'session-1' }))
        })
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1'))
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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

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

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('session-1'))
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
            <NewSession
                api={api}
                machines={[machine]}
                initialMachineId="machine-1"
                initialDirectory="C:\\repo"
                continueFromSession={continueFromSession}
                onSuccess={mocks.onSuccess}
                onCancel={() => {}}
            />
        )

        expect(screen.getByText('newSession.continue.description')).toBeInTheDocument()
        await waitFor(() => expect(screen.getByDisplayValue('codex')).toBeChecked())
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('continued-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'codex',
            // The continued session named a non-shortlist model; the
            // hardcoded pin wins, other settings still carry over.
            model: 'gpt-6.1-sol',
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)

        // GLM serves no effort levels, so the field is gone and a value
        // remembered from a pre-branding launch cannot leak into the spawn.
        expect(screen.queryByTestId('launch-effort')).toBeNull()
        fireEvent.click(screen.getByTestId('create'))

        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('claude-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            effort: undefined
        }))
    })
})

describe('NewSession fork launch defaults', () => {
    beforeEach(() => {
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
        mocks.cursorModels = []
        mocks.cursorSkus = []
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)

        // Fork: remembered permission modes no longer pin the form; every
        // fresh launch opens on the flavor's own YOLO-equivalent.
        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'claude-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'bypassPermissions' })))
    })

    it('lands a fresh Codex form on YOLO with no stored preference', async () => {
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)

        expect(screen.queryByText('misc.permissionMode')).toBeNull()
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'codex-session' })
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' })))
    })

    it.each(['standard', 'fast'] as const)('submits the selected Codex %s badge', async (serviceTier) => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'speed-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)

        expect(screen.queryByText('newSession.collaborationMode')).toBeNull()
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        if (serviceTier === 'standard') fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeStandard' }))
        expect(screen.getByRole('button', { name: serviceTier === 'fast' ? 'misc.fastModeFast' : 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ serviceTier, permissionMode: 'yolo' })))
    })

    it('drops Fast when switching to a Codex model without a fast tier', async () => {
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'standard-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
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
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)

        expect(screen.getByRole('button', { name: 'Grok 4.7 Extra High' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: label }))
        expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'misc.fastModeStandard' })).toHaveAttribute('aria-pressed', 'true')
        if (speed === 'fast') fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        expect(screen.queryByText('newSession.yolo')).toBeNull()

        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledWith('fork-session'))
        expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model, yolo: true, serviceTier: undefined }))
    })

    it('reveals the full Cursor catalog behind the load-other-models hatch', async () => {
        savePreferredAgent('cursor')
        mocks.cursorModels = [{ modelId: 'composer-2.5[fast=true]' }, { modelId: 'composer-2.5[fast=false]' }]
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\repo" onSuccess={mocks.onSuccess} onCancel={() => {}} />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Grok 4.7 Extra High' })).toBeInTheDocument())
        expect(screen.queryByTestId('model')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        await waitFor(() => expect(screen.getByTestId('model')).toBeInTheDocument())
    })

    it('keeps Grok High effort when enabling Fast through the full Cursor picker', async () => {
        savePreferredAgent('cursor')
        mocks.cursorModels = [{ modelId: 'grok-4.7', name: 'Grok 4.7' }]
        mocks.cursorSkus = [{ modelId: 'grok-4.7-high' }, { modelId: 'grok-4.7-high-fast' }, { modelId: 'grok-4.7-xhigh' }, { modelId: 'grok-4.7-xhigh-fast' }]
        mocks.nextModelValue = 'grok-4.7-high'
        mocks.spawnSession.mockResolvedValue({ type: 'success', sessionId: 'high-fast-session' })
        render(<NewSession api={api} machines={[machine]} initialMachineId="machine-1" initialDirectory="C:\\repo" onSuccess={mocks.onSuccess} onCancel={() => { }} />)
        fireEvent.click(screen.getByRole('button', { name: 'newSession.model.loadOptions' }))
        fireEvent.click(screen.getAllByTestId('model')[1])
        fireEvent.click(screen.getByRole('button', { name: 'misc.fastModeFast' }))
        fireEvent.click(screen.getByTestId('create'))
        await waitFor(() => expect(mocks.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'grok-4.7-high-fast' })))
    })
})
