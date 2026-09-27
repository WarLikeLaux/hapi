import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { PwaUpdateBanner, PwaUpdateBannerWithStatusOffset } from '@/components/PwaUpdateBanner'

const usePwaUpdateMock = vi.fn()
const useVoiceOptionalMock = vi.fn()

vi.mock('@/lib/pwa-update-context', () => ({
    usePwaUpdateContext: () => usePwaUpdateMock(),
}))

vi.mock('@/lib/voice-context', () => ({
    useVoiceOptional: () => useVoiceOptionalMock(),
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            impact: vi.fn(),
            notification: vi.fn(),
        },
    }),
}))

function renderBanner() {
    return render(
        <I18nProvider>
            <PwaUpdateBanner />
        </I18nProvider>,
    )
}

describe('PwaUpdateBanner', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useVoiceOptionalMock.mockReturnValue(null)
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn(() => 'en'),
                setItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
                key: vi.fn(() => null),
                length: 0,
            },
            configurable: true,
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('does not render when no update is in flight', () => {
        usePwaUpdateMock.mockReturnValue({
            updating: false,
        })

        renderBanner()

        expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument()
    })

    it('renders a status banner while the auto-reload is pending, with no action button', () => {
        usePwaUpdateMock.mockReturnValue({
            updating: true,
        })

        renderBanner()

        const banner = screen.getByTestId('pwa-update-banner')
        expect(banner).toBeInTheDocument()
        expect(banner.getAttribute('role')).toBe('status')
        expect(screen.getByText('Updating HAPI…')).toBeInTheDocument()
        expect(
            screen.getByText('A new version was just deployed and HAPI is reloading to apply it.'),
        ).toBeInTheDocument()
        expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('honors a custom top offset when provided', () => {
        usePwaUpdateMock.mockReturnValue({
            updating: true,
        })

        render(
            <I18nProvider>
                <PwaUpdateBanner topClassName="top-12" />
            </I18nProvider>,
        )

        expect(screen.getByTestId('pwa-update-banner')).toHaveClass('top-12')
    })

    it('offsets below voice error banners when shown inside the voice provider', () => {
        usePwaUpdateMock.mockReturnValue({
            updating: true,
        })
        useVoiceOptionalMock.mockReturnValue({
            status: 'error',
            errorMessage: 'Mic failed',
        })

        render(
            <I18nProvider>
                <PwaUpdateBannerWithStatusOffset isSyncing={false} isReconnecting={false} />
            </I18nProvider>,
        )

        expect(screen.getByTestId('pwa-update-banner')).toHaveClass(
            'top-[calc(env(safe-area-inset-top)+3rem)]'
        )
    })
})
