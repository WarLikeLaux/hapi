import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { EffortField } from './EffortField'

afterEach(cleanup)

function renderEffortField(overrides: Partial<Parameters<typeof EffortField>[0]> = {}) {
    render(
        <I18nProvider>
            <EffortField
                agent="codex"
                effort="auto"
                onEffortChange={() => {}}
                reasoningEffort="default"
                onReasoningEffortChange={() => {}}
                isDisabled={false}
                {...overrides}
            />
        </I18nProvider>
    )
}

describe('EffortField', () => {
    it('shows supported Codex efforts as selectable chips', () => {
        const onReasoningEffortChange = vi.fn()
        renderEffortField({
            reasoningEffort: 'medium',
            codexOptions: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }],
            onReasoningEffortChange
        })

        const group = screen.getByRole('group', { name: 'Effort' })
        expect(within(group).getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true')
        expect(within(group).queryByRole('button', { name: 'High' })).toBeNull()
        fireEvent.click(within(group).getByRole('button', { name: 'Low' }))
        expect(onReasoningEffortChange).toHaveBeenCalledWith('low')
    })

    it('shows OpenCode model variants as the same chips', () => {
        const onReasoningEffortChange = vi.fn()
        renderEffortField({
            agent: 'opencode',
            reasoningEffort: 'max',
            opencodeOptions: [{ value: 'minimal', label: 'Minimal' }, { value: 'max', label: 'Max' }],
            onReasoningEffortChange
        })

        expect(screen.queryByRole('combobox')).toBeNull()
        const group = screen.getByRole('group', { name: 'Effort' })
        expect(within(group).getByRole('button', { name: 'Max' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(group).getByRole('button', { name: 'Minimal' }))
        expect(onReasoningEffortChange).toHaveBeenCalledWith('minimal')
    })
})
