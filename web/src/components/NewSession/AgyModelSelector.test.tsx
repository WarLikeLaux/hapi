import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { AgyModelSelector } from './AgyModelSelector'

afterEach(cleanup)

function renderSelector(overrides: Partial<Parameters<typeof AgyModelSelector>[0]> = {}) {
    render(
        <I18nProvider>
            <AgyModelSelector
                machineId="machine-1"
                isLoading={false}
                error={null}
                availableModels={[]}
                selectedModel={null}
                onModelChange={() => {}}
                {...overrides}
            />
        </I18nProvider>
    )
}

describe('AgyModelSelector', () => {
    it('says it is fetching models, which is what the wait is actually spent on', () => {
        renderSelector({ isLoading: true })

        expect(screen.getByText('Fetching available models…')).toBeInTheDocument()
        expect(screen.queryByText(/authentication/i)).not.toBeInTheDocument()
    })

    it('still calls out authentication when that is what the machine reported', () => {
        renderSelector({ error: 'Authentication required. Please run `agy` in a terminal to sign in with Google.' })

        expect(screen.getByTestId('agy-model-auth-error')).toBeInTheDocument()
    })

    it('keeps the cached catalog usable while saying the machine failed its last sign-in check, with a way to re-probe', () => {
        const onRetry = vi.fn()
        renderSelector({
            warning: 'Authentication required. Please run `agy` in a terminal to sign in with Google.',
            availableModels: [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }],
            onRetry
        })

        expect(screen.getByTestId('agy-model-list')).toBeInTheDocument()
        expect(screen.getByTestId('agy-model-stale-warning')).toBeInTheDocument()
        expect(screen.queryByTestId('agy-model-auth-error')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('keeps a picked model listed after the catalog stops advertising it', () => {
        renderSelector({
            availableModels: [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }],
            selectedModel: 'gemini-3.5-flash-medium'
        })

        const select = screen.getByTestId('agy-model-list') as HTMLSelectElement
        expect(select.value).toBe('gemini-3.5-flash-medium')
        expect(screen.getByRole('option', { name: 'Gemini 3.5 Flash (Medium) (no longer listed)' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Gemini 3.8 Flash (High)' })).toBeInTheDocument()
    })

    it('falls back to the wire id for a picked model nobody has a label for', () => {
        renderSelector({
            availableModels: [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }],
            selectedModel: 'gemini-9.9-experimental'
        })

        expect(screen.getByRole('option', { name: 'gemini-9.9-experimental (no longer listed)' })).toBeInTheDocument()
    })

    it('shows the pinned default model as the first option, named after itself and listed once', () => {
        // With no model picked, a session starts on DEFAULT_AGY_MODEL (runAgy's
        // fallback). The option is the model's own name — no "Default —" prefix —
        // and the catalog row for the same model is not repeated.
        renderSelector({
            availableModels: [
                { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
                { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }
            ]
        })

        const select = screen.getByTestId('agy-model-list') as HTMLSelectElement
        expect(select.value).toBe('')
        expect([...select.options].map((option) => option.textContent)).toEqual([
            'Gemini 3.8 Flash (Medium)',
            'Gemini 3.8 Flash (High)'
        ])
    })

    it('displays an explicit pick of the default model as the default option', () => {
        renderSelector({
            availableModels: [{ modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' }],
            selectedModel: 'gemini-3.8-flash-medium'
        })

        expect((screen.getByTestId('agy-model-list') as HTMLSelectElement).value).toBe('')
    })

    it('says a re-probe is running instead of leaving Retry looking idle', () => {
        // The probe runs agy, so the answer can be tens of seconds away; without
        // this the button is the only thing on screen and nothing about it moves.
        const onRetry = vi.fn()
        renderSelector({
            warning: 'Authentication required. Please run `agy` in a terminal to sign in with Google.',
            availableModels: [{ modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }],
            isFetching: true,
            onRetry
        })

        const button = screen.getByRole('button', { name: 'Fetching available models…' })
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(onRetry).not.toHaveBeenCalled()
    })
})
