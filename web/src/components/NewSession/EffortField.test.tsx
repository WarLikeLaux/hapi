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
                codexReasoningOptions={[{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }]}
                {...overrides}
            />
        </I18nProvider>
    )
}

describe('EffortField codex reasoning options', () => {
    it('names the no-pick option after the config default effort and skips the duplicate row', () => {
        renderEffortField({ codexDefaultReasoningEffort: 'high' })

        const options = [...(screen.getAllByRole('option').map((option) => option.textContent))]
        expect(options).toEqual(['High', 'Low', 'Medium', 'XHigh'])
    })

    it('keeps the explicit row while that effort is pinned, so the select resolves', () => {
        renderEffortField({ codexDefaultReasoningEffort: 'high', reasoningEffort: 'high' })

        const options = screen.getAllByRole('option').map((option) => option.textContent)
        expect(options).toEqual(['High', 'Low', 'Medium', 'High', 'XHigh'])
    })

    it('falls back to the plain Default word when the config sets no effort', () => {
        renderEffortField({ codexDefaultReasoningEffort: null })

        const options = screen.getAllByRole('option').map((option) => option.textContent)
        expect(options).toEqual(['Default', 'Low', 'Medium', 'High', 'XHigh'])
    })
})
