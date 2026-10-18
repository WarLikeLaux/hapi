import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { OpencodeModelSelector } from './OpencodeModelSelector'

describe('OpencodeModelSelector', () => {
    it('keeps the HAPI default label when discovery supplies a provider-prefixed name', () => {
        const props = {
            cwd: '/project', machineId: 'machine-1', isLoading: false, error: null,
            availableModels: [], currentModelId: 'opencode-go/gemini-4-argon-contributor', selectedModel: null,
            defaultModelName: 'Gemini 4 Argon', onModelChange: vi.fn(),
        }
        const view = render(<I18nProvider><OpencodeModelSelector {...props} /></I18nProvider>)
        expect(screen.getByRole('combobox')).toHaveDisplayValue('Gemini 4 Argon')
        view.rerender(<I18nProvider><OpencodeModelSelector {...props}
            availableModels={[{ modelId: 'opencode-go/gemini-4-argon-contributor', name: 'OpenCode Go/Gemini 4 Argon Contributor' }]}
        /></I18nProvider>)
        expect(screen.getByRole('combobox')).toHaveDisplayValue('Gemini 4 Argon')
    })

    it('uses the shared combobox interaction for discovered models', () => {
        const onModelChange = vi.fn()
        render(<I18nProvider>
            <OpencodeModelSelector
                cwd="/project"
                machineId="machine-1"
                isLoading={false}
                error={null}
                availableModels={[
                    { modelId: 'openai/gpt-5.4', name: 'GPT-5.4' },
                    { modelId: 'openai/gpt-5.6', name: 'GPT-5.6' }
                ]}
                currentModelId="openai/gpt-5.4"
                selectedModel={null}
                onModelChange={onModelChange}
            />
        </I18nProvider>)

        expect(screen.getByRole('combobox')).toHaveDisplayValue('GPT-5.4')
        expect(screen.getAllByRole('option', { name: /^GPT-5\.4$/ })).toHaveLength(1)
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'openai/gpt-5.6' } })
        expect(onModelChange).toHaveBeenCalledWith('openai/gpt-5.6')
    })
})
