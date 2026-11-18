import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MACHINE_CAPABILITIES } from '@hapi/protocol/runnerCapabilities'
import { describe, expect, it, vi } from 'vitest'
import { useAppContext } from '@/lib/app-context'
import { I18nProvider } from '@/lib/i18n-context'
import SettingsLimitsPage, { UnavailableRow } from './limits'

vi.mock('@/lib/app-context', () => ({ useAppContext: vi.fn() }))

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

it('shows manually refreshed Claude quotas inside only the machine that can run Claude Code', async () => {
    localStorage.setItem('hapi-lang', 'en')
    const now = Date.now()
    const capabilities = [MACHINE_CAPABILITIES.AgentAvailability, MACHINE_CAPABILITIES.AgentQuotas]
    const machines = ['with-claude', 'without-claude'].map(id => ({
        id, active: true, metadata: { host: id, capabilities },
    }))
    const api = {
        getMachines: async () => ({ machines }),
        getQuotas: async () => ({ quotas: machines.map(({ id }) => ({
            machineId: id, displayName: id, online: true, receivedAt: now, unavailable: [],
            quotas: [{ source: 'codex:weekly', usedPercent: 12, resetsAt: null, measuredAt: now / 1000 }],
        })) }),
        getMachineAgentAvailability: async (id: string) => ({
            agents: [{ agent: 'claude', available: id === 'with-claude' }],
        }),
        getMachineAgentQuotas: vi.fn(async () => ({ accounts: [{
            agent: 'claude', available: true, status: 'ok', updatedAt: now,
            buckets: [{ id: 'weekly', window: 'weekly', usedPercent: 28, resetsAt: null }],
        }] })),
    }
    vi.mocked(useAppContext).mockReturnValue({ api } as unknown as ReturnType<typeof useAppContext>)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><I18nProvider><SettingsLimitsPage /></I18nProvider></QueryClientProvider>)

    const refresh = await screen.findByRole('button', { name: 'Refresh quotas' })
    const supportedSection = screen.getByRole('heading', { name: 'with-claude' }).closest('section')!
    expect(within(supportedSection).getByText('Codex · week')).toBeInTheDocument()
    expect(supportedSection).toContainElement(refresh)
    expect(screen.getAllByRole('button', { name: 'Refresh quotas' })).toHaveLength(1)
    expect(api.getMachineAgentQuotas).not.toHaveBeenCalled()

    fireEvent.click(refresh)

    expect(await within(supportedSection).findByText('Claude · week')).toBeInTheDocument()
    expect(api.getMachineAgentQuotas).toHaveBeenCalledWith('with-claude', true)
})
