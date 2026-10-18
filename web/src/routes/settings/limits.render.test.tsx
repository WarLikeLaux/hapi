import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { UnavailableRow } from './limits'

describe('quota authentication failures', () => {
    it('explains how to replace an expired Go API key without treating other providers as Go', () => {
        localStorage.setItem('hapi-lang', 'en')
        render(
            <I18nProvider>
                <UnavailableRow unavailable={{ source: 'opencode:monthly', reason: 'auth_expired' }} />
                <UnavailableRow unavailable={{ source: 'codex:weekly', reason: 'auth_expired' }} />
                <UnavailableRow unavailable={{ source: 'opencode:monthly', reason: 'unavailable', detail: 'Console sign-in required' }} />
            </I18nProvider>
        )
        expect(screen.getByText('API key expired')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Create a new API key in OpenCode Console/ })).toHaveAttribute('href', 'https://opencode.ai/console')
        expect(screen.getByText(/\/connect → OpenCode Go/)).toBeInTheDocument()
        expect(screen.getByText(/Signing in again will not renew/)).toBeInTheDocument()
        expect(screen.getAllByText('Authentication expired')).toHaveLength(1)
        expect(screen.getByText('Reconnect Console')).toBeInTheDocument()
        expect(screen.getByText(/opencode console login/)).toBeInTheDocument()
    })
})
