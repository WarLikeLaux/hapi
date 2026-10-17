import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    it('hides the effort picker for Codex', () => {
        renderEffortField()

        expect(screen.queryByRole('combobox')).toBeNull()
        expect(screen.queryByText('Reasoning effort')).toBeNull()
    })

    it('still offers OpenCode reasoning variants', () => {
        renderEffortField({
            agent: 'opencode',
            opencodeVariantOptions: ['low', 'high']
        })

        expect(screen.getByRole('combobox')).toBeTruthy()
        expect(screen.getByRole('option', { name: 'high' })).toBeTruthy()
    })
})
