import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { setClaudeGlmBranded } from '@/lib/claudeGlmBranding'
import type { PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import type { ComposerSendIntent } from '@/lib/messageDelivery'
import type { ComposerToolbarLayout } from '@/hooks/useComposerToolbarLayout'
import { HappyComposer } from './HappyComposer'

/**
 * Focused harness for the generic model/effort value buttons and the
 * settings-sheet section order. Reuses the assistant-ui mock strategy from
 * HappyComposer.sendError.test.tsx but keeps ComposerButtons unmocked so the
 * new value buttons are exercised for real.
 */
type FakeAttachment = { id: string; status: { type: 'complete' } }
type MockComposerInputProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
    asChild?: boolean
    maxRows?: number
    submitOnEnter?: boolean
    cancelOnEscape?: boolean
}
type FakeRuntimeState = {
    composer: { text: string; attachments: FakeAttachment[] }
    thread: { isRunning: boolean; isDisabled: boolean }
}

const runtime = vi.hoisted(() => ({
    snapshot: {
        composer: { text: '', attachments: [] as FakeAttachment[] },
        thread: { isRunning: false, isDisabled: false },
    } as FakeRuntimeState,
    setSnapshot: null as null | ((updater: (current: FakeRuntimeState) => FakeRuntimeState) => void),
    pendingSendIntentRef: { current: 'default' },
    sentIntents: [] as ComposerSendIntent[],
    narrowViewport: false,
    toolbarLayout: null as ComposerToolbarLayout | null,
}))

vi.mock('@assistant-ui/react', async () => {
    const React = await import('react')
    return {
        useAui: () => ({
            composer: () => ({
                setText: (text: string) => {
                    runtime.setSnapshot!((current) => ({
                        ...current,
                        composer: { ...current.composer, text },
                    }))
                },
                send: () => {
                    const intent = runtime.pendingSendIntentRef?.current ?? 'default'
                    runtime.sentIntents.push(intent as ComposerSendIntent)
                    if (runtime.pendingSendIntentRef) runtime.pendingSendIntentRef.current = 'default'
                    runtime.setSnapshot!((current) => ({
                        ...current,
                        composer: { text: '', attachments: [] },
                    }))
                },
                addAttachment: async () => {},
            }),
            thread: () => ({ cancelRun: () => {} }),
        }),
        useAuiState: (selector: (state: typeof runtime.snapshot) => unknown) => selector(runtime.snapshot),
        ComposerPrimitive: {
            Root: ({ children, onSubmit }: { children: ReactNode; onSubmit?: () => void }) => (
                <form onSubmit={onSubmit}>{children}</form>
            ),
            AddAttachment: ({ children }: { children: ReactNode }) => <>{children}</>,
            Input: React.forwardRef<HTMLTextAreaElement, MockComposerInputProps>(
                ({
                    asChild: _asChild,
                    onChange,
                    maxRows: _maxRows,
                    submitOnEnter: _submitOnEnter,
                    cancelOnEscape: _cancelOnEscape,
                    ...props
                }, ref) => (
                    <textarea
                        {...props}
                        ref={ref}
                        value={runtime.snapshot.composer.text}
                        onChange={(event) => {
                            runtime.setSnapshot!((current) => ({
                                ...current,
                                composer: { ...current.composer, text: event.target.value },
                            }))
                        }}
                    />
                ),
            ),
        },
    }
})
vi.mock('@/hooks/useComposerToolbarLayout', async () => {
    const actual = await import('@/hooks/useComposerToolbarLayout')
    return {
        ...actual,
        useComposerToolbarLayout: () => ({ layout: runtime.toolbarLayout ?? actual.DEFAULT_COMPOSER_TOOLBAR_LAYOUT }),
    }
})
vi.mock('@/hooks/useNarrowViewport', () => ({
    useNarrowViewport: () => runtime.narrowViewport,
}))
vi.mock('@/hooks/useComposerDraft', () => ({
    useComposerDraft: () => ({ sessionId: undefined, complete: true, restoredAny: false, hasStoredAttachments: false }),
}))
vi.mock('@/hooks/useComposerEnterBehavior', () => ({
    useComposerEnterBehavior: () => ({ composerEnterBehavior: 'send' }),
    getEffectiveComposerEnterBehavior: (behavior: string, isTouch: boolean) => isTouch ? 'newline' : behavior,
}))
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ haptic: { impact: () => {}, notification: () => {} }, isTouch: false }) }))
vi.mock('@/hooks/usePWAInstall', () => ({ usePWAInstall: () => ({ isStandalone: false, isIOS: false }) }))
vi.mock('@/hooks/useActiveWord', () => ({ useActiveWord: () => null }))
vi.mock('@/hooks/useActiveSuggestions', () => ({ useActiveSuggestions: () => [[], -1, () => {}, () => {}, () => {}] }))
vi.mock('@/components/ChatInput/FloatingOverlay', () => ({ FloatingOverlay: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/ChatInput/Autocomplete', () => ({ Autocomplete: () => null }))
vi.mock('@/components/AssistantChat/StatusBar', () => ({ StatusBar: () => null }))

function renderComposer(agentFlavor: string, overrides: Partial<Parameters<typeof HappyComposer>[0]> = {}) {
    render(
        <I18nProvider>
            <HappyComposer
                sessionId="composer-test"
                disabled={false}
                agentFlavor={agentFlavor}
                model="claude-sonnet-4"
                effort="high"
                permissionMode="default"
                onModelChange={vi.fn()}
                onEffortChange={vi.fn()}
                onPermissionModeChange={vi.fn()}
                availableModelOptions={[{ value: 'claude-sonnet-4', label: 'Sonnet 4' }]}
                pendingSendIntentRef={runtime.pendingSendIntentRef as { current: ComposerSendIntent }}
                {...overrides}
            />
        </I18nProvider>
    )
}

describe('HappyComposer generic model/effort value buttons', () => {
    afterEach(() => {
        cleanup()
        setClaudeGlmBranded(false)
        runtime.setSnapshot = null
        runtime.narrowViewport = false
        runtime.toolbarLayout = null
        runtime.snapshot.thread.isDisabled = false
        runtime.sentIntents = []
    })

    it('shows the model pill with inline effort for Claude on wide viewports', () => {
        renderComposer('claude')
        expect(screen.getByText('Sonnet 4 (High)')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    })

    it('shows the model pill for flavors without effort support', () => {
        renderComposer('codex')
        expect(screen.getByText('Sonnet 4')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
    })

    it('hides the model pill on narrow viewports, keeping settings', () => {
        runtime.narrowViewport = true
        renderComposer('claude')
        expect(screen.queryByText('Sonnet 4 (High)')).toBeNull()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    })

    it('keeps the model pill non-interactive (selection lives in the settings sheet)', () => {
        renderComposer('claude')
        fireEvent.click(screen.getByText('Sonnet 4 (High)'))
        expect(screen.queryByText('Model')).toBeNull()
    })

    it('opens the full sheet from the gear with Model before Permission', () => {
        renderComposer('claude')
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        const model = screen.getByText('Model')
        const permission = screen.getByText('Permission Mode')
        expect(model.compareDocumentPosition(permission) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText('Effort')).toBeTruthy()
    })

    it('shows generic value buttons for Pi with the provider-qualified model label', () => {
        renderComposer('pi', {
            piModels: [
                { provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true },
                { provider: 'vertex', modelId: 'gemini-2.5-pro', name: 'Vertex Gemini 2.5 Pro', reasoning: true },
            ],
            piSelectedModel: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
        })
        // Pi uses the same display-only model pill as every other flavor.
        expect(screen.getByText('Gemini 2.5 Pro (High)')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    })

    it('opens the settings sheet with provider-grouped model rows for Pi', () => {
        renderComposer('pi', {
            piModels: [
                { provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true },
                { provider: 'vertex', modelId: 'gemini-2.5-pro', name: 'Vertex Gemini 2.5 Pro', reasoning: true },
            ],
            piSelectedModel: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByText('Model')).toBeTruthy()
        // The sheet row for the selected provider keeps the bare model name.
        expect(screen.getAllByText('Gemini 2.5 Pro').length).toBeGreaterThan(0)
        expect(screen.getByText('Vertex Gemini 2.5 Pro')).toBeTruthy()
        // The full sheet from the gear includes the Effort section.
        expect(screen.getByText('Effort')).toBeTruthy()
    })

    it('keeps the gear reachable on narrow viewports even when the toolbar layout hides it', () => {
        runtime.narrowViewport = true
        runtime.toolbarLayout = {
            mode: 'left',
            left: ['attachment', 'expand', 'terminal'],
            right: [],
            hidden: ['settings', 'abort'],
        }
        renderComposer('claude')
        // Narrow mode collapses the model pill into the settings sheet, so the
        // gear must stay visible regardless of the persisted layout.
        expect(screen.queryByText('Sonnet 4 (High)')).toBeNull()
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    })

    it('keeps the Pi settings gear live mid-turn on narrow viewports', () => {
        runtime.narrowViewport = true
        runtime.snapshot.thread.isDisabled = true
        renderComposer('pi', {
            piModels: [
                { provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true },
            ],
            piSelectedModel: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
        })
        // Value buttons are collapsed on narrow; the gear is the only trigger and
        // must stay clickable while a Pi turn is running (#1442).
        const gear = screen.getByRole('button', { name: 'Settings' })
        expect(gear).not.toBeDisabled()
        fireEvent.click(gear)
        expect(screen.getByText('Model')).toBeTruthy()
        expect(screen.getByText('Gemini 2.5 Pro')).toBeTruthy()
    })

    it('highlights only the matching provider row when model IDs collide across providers', () => {
        renderComposer('pi', {
            piModels: [
                { provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true },
                { provider: 'vertex', modelId: 'gemini-2.5-pro', name: 'Vertex Gemini 2.5 Pro', reasoning: true },
            ],
            piSelectedModel: { provider: 'vertex', modelId: 'gemini-2.5-pro' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        const sheetRow = (name: string) => screen.getAllByText(name)
            .map((el) => el.closest('button'))
            .find((btn) => btn?.className.includes('w-full'))!
        const geminiRow = sheetRow('Gemini 2.5 Pro')
        const vertexRow = sheetRow('Vertex Gemini 2.5 Pro')
        const selectedClass = 'text-[var(--app-link)]'
        expect(geminiRow.querySelector('span')!.className).not.toContain(selectedClass)
        expect(vertexRow.querySelector('span')!.className).toContain(selectedClass)
    })

    it('does not show provider-less model rows when the Pi catalog is empty', () => {
        renderComposer('pi', {
            model: 'gemini-2.5-pro',
            piModels: [],
            piSelectedModel: null,
        })
        // Without a resolved catalog there are no model or effort settings at
        // all: the gear is hidden and no provider-less fallback rows can be
        // reached (selecting one would post a bare model id the Pi runner
        // cannot resolve to a provider).
        expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
        expect(screen.queryByText('Model')).toBeNull()
        expect(screen.queryByText('Default')).toBeNull()
    })

    it('clears Cursor variant drill-down when the sheet is closed and reopened through the gear', () => {
        renderComposer('cursor', {
            model: 'composer-2.5-fast',
            selectedModelBase: 'composer-2.5',
            availableModelOptions: [
                { value: 'composer-2.5', label: 'Composer 2.5' },
                { value: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
                { value: 'composer-2.5-mini', label: 'Composer 2.5 Mini' },
            ],
            resolveModelVariantsForBase: (base) => base === 'composer-2.5'
                ? [
                    { value: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
                    { value: 'composer-2.5-mini', label: 'Composer 2.5 Mini' },
                ]
                : [],
        })
        // Open from the gear (the model pill is display-only).
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        // Drill into the multi-variant base row: the Model section is replaced
        // by the variant sub-list with a back control.
        const baseRow = screen.getAllByRole('button', { name: 'Composer 2.5' })
            .find((btn) => btn.className.includes('w-full'))!
        fireEvent.click(baseRow)
        expect(screen.queryByText('Model')).toBeNull()
        expect(screen.getByText('← Models')).toBeTruthy()
        // Close and reopen through the gear: drill-down must reset to the
        // base model list.
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.queryByText('← Models')).toBeNull()
        expect(screen.getByText('Model')).toBeTruthy()
    })

    it('exposes no effort action while the Pi catalog is unresolved mid-turn', () => {
        runtime.snapshot.thread.isDisabled = true
        renderComposer('pi', {
            model: 'gemini-2.5-pro',
            piModels: [],
            piSelectedModel: null,
        })
        // With no resolved catalog entry there is no capability map, so no
        // effort value button and no gear that could open an effort sheet
        // (the old dedicated control was disabled in this state too). The
        // model value button must not render either: a bare session id has no
        // provider and the sheet has no Model section to open.
        expect(screen.queryByText('gemini-2.5-pro')).toBeNull()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
    })

    it('clears the Pi thinking level when the selected effort row is clicked again', () => {
        const effortChanges: Array<string | null> = []
        renderComposer('pi', {
            effort: 'high',
            piModels: [
                { provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true },
            ],
            piSelectedModel: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
            onEffortChange: (level) => effortChanges.push(level),
        })
        // Open the sheet from the gear (effort has no dedicated toolbar button
        // anymore), then re-click the 'High' row to clear the pinned level.
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        const effortRows = screen.getAllByRole('button', { name: 'High' })
        expect(effortRows.length).toBeGreaterThan(0)
        fireEvent.click(effortRows[0])
        expect(effortChanges).toEqual([null])
    })

    it('re-evaluates the Pi sheet row disabled state when configuration controls change', () => {
        const common = {
            sessionId: 'composer-test',
            disabled: false,
            agentFlavor: 'pi' as const,
            model: 'gemini-2.5-pro',
            effort: 'high' as const,
            permissionMode: 'default' as const,
            onModelChange: vi.fn(),
            onEffortChange: vi.fn(),
            onPermissionModeChange: vi.fn(),
            piModels: [{ provider: 'gemini', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true }],
            piSelectedModel: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
            pendingSendIntentRef: runtime.pendingSendIntentRef as { current: ComposerSendIntent },
        }
        const { rerender } = render(
            <I18nProvider>
                <HappyComposer {...common} active={true} />
            </I18nProvider>
        )
        // Open the sheet while controls are live.
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        const sheetRow = () => screen.getAllByRole('button', { name: 'Gemini 2.5 Pro' })
            .find((btn) => btn.className.includes('w-full'))!
        expect(sheetRow()).not.toBeDisabled()
        // Inactive session disables configuration controls; the sheet rows must follow.
        rerender(
            <I18nProvider>
                <HappyComposer {...common} active={false} />
            </I18nProvider>
        )
        expect(sheetRow()).toBeDisabled()
    })

    it('maps the default selection (model=null) onto the localized default option label', () => {
        renderComposer('claude', { model: null })
        expect(screen.getByText('Default (High)')).toBeTruthy()
        expect(screen.queryByText('Sonnet 4')).toBeNull()
    })

    it('maps auto/default wire values onto the localized default option label', () => {
        renderComposer('claude', { model: 'auto' })
        expect(screen.getByText('Default (High)')).toBeTruthy()
    })

    it('shows the pinned reasoning effort inline on the Codex model pill', () => {
        renderComposer('codex', {
            modelReasoningEffort: 'high',
            onModelReasoningEffortChange: vi.fn(),
            availableModelReasoningEffortOptions: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
        })
        expect(screen.getByText('Sonnet 4 (High)')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
    })

    it('names the Codex inline effort after the config default effort when nothing is pinned', () => {
        renderComposer('codex', {
            modelReasoningEffort: null,
            defaultModelReasoningEffort: 'high',
            onModelReasoningEffortChange: vi.fn(),
            availableModelReasoningEffortOptions: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
        })
        // Nothing is pinned, but the no-pick state runs the config default (high).
        expect(screen.getByText('Sonnet 4 (High)')).toBeTruthy()
    })

    it('opens the full sheet with Reasoning Effort from the gear for Codex', () => {
        renderComposer('codex', {
            modelReasoningEffort: 'high',
            onModelReasoningEffortChange: vi.fn(),
            availableModelReasoningEffortOptions: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
        })
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByText('Reasoning Effort')).toBeTruthy()
        expect(screen.getByText('Model')).toBeTruthy()
    })

    it('labels the GLM-branded claude model pill after the default GLM model and hides effort', () => {
        setClaudeGlmBranded(true)
        renderComposer('claude', { model: null })
        expect(screen.getByText('GLM 5.3 Flash')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Default' })).toBeNull()
        // GLM has no effort levels: no effort button even though effort="high".
        expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'High' })).toBeNull()
    })

    it('keeps the Model sheet section but drops Effort for GLM-branded claude', () => {
        setClaudeGlmBranded(true)
        renderComposer('claude', { model: null })
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByText('Model')).toBeTruthy()
        // The value button caption and the matching sheet row share the label.
        expect(screen.getAllByText('GLM 5.3 Flash').length).toBeGreaterThan(1)
        expect(screen.queryByText('Effort')).toBeNull()
        expect(screen.getByText('Permission Mode')).toBeTruthy()
    })
})
