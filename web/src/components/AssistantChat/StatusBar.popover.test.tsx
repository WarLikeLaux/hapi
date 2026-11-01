import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { StatusBar } from './StatusBar'

describe('StatusBar context details popover', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.restoreAllMocks()
    })

    it('preserves ready, offline, and working status labels', () => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        const { rerender } = render(
            <I18nProvider>
                <StatusBar active thinking={false} agentState={null} />
            </I18nProvider>
        )

        const onlineLabel = screen.getByLabelText('Готов')

        rerender(
            <I18nProvider>
                <StatusBar active={false} thinking={false} agentState={null} />
            </I18nProvider>
        )

        const offlineLabel = screen.getByText('offline')
        expect(offlineLabel.className.split(' ')).toContain('text-[#999]')
        expect(offlineLabel.previousElementSibling?.className.split(' ')).toContain('bg-[#999]')

        rerender(
            <I18nProvider>
                <StatusBar active thinking agentState={null} />
            </I18nProvider>
        )

        const thinkingLabel = screen.getByLabelText('Работает…')
    })

    it('shows live activity only while working and preserves connection and permission priority', () => {
        const view = (active: boolean, thinking: boolean, agentState: Parameters<typeof StatusBar>[0]['agentState'] = null) => (
            <I18nProvider>
                <StatusBar active={active} thinking={thinking} activity="test" agentState={agentState} />
            </I18nProvider>
        )
        const { rerender } = render(view(true, true))
        expect(screen.getByLabelText('Запускает тесты…')).toBeVisible()
        rerender(view(true, false))
        expect(screen.getByLabelText('Готов')).toBeVisible()
        rerender(view(false, true))
        expect(screen.getByText('offline')).toBeVisible()
        rerender(view(true, true, { requests: { approval: { tool: 'Bash', arguments: {} } } }))
        expect(screen.getByText('permission required')).toBeVisible()
    })

    it.each(['fast', 'priority'])('shows a separate Fast label beside Yolo for %s and removes it when disabled', (tier) => {
        const view = (serviceTier: string | null) => (
            <I18nProvider>
                <StatusBar active thinking={false} agentState={null} agentFlavor="codex"
                    permissionMode="yolo" model="gpt-6.1-sol" serviceTier={serviceTier} />
            </I18nProvider>
        )
        const { rerender } = render(view(tier))
        expect(screen.getByText('Fast')).toBeVisible()
        expect(screen.getByText('Yolo')).toBeVisible()
        rerender(view('standard'))
        expect(screen.queryByText('Fast')).toBeNull()
        expect(screen.getByText('Yolo')).toBeVisible()
        rerender(view(null))
        expect(screen.queryByText('Fast')).toBeNull()
    })

    it.each(['codex', 'claude'])('does not infer Fast from model or effort for %s', (agentFlavor) => {
        render(
            <I18nProvider>
                <StatusBar active thinking={false} agentState={null} agentFlavor={agentFlavor}
                    model="gpt-6.1-sol-fast" modelReasoningEffort="high" />
            </I18nProvider>
        )
        expect(screen.queryByText('Fast')).toBeNull()
    })

    it('tracks Cursor Fast variants including explicit fast=false', () => {
        const view = (model: string) => (
            <I18nProvider>
                <StatusBar active thinking={false} agentState={null} agentFlavor="cursor" model={model} />
            </I18nProvider>
        )
        const { rerender } = render(view('composer-2.5-fast'))
        expect(screen.getByText('Fast')).toBeVisible()
        rerender(view('composer-2.5[fast=false]'))
        expect(screen.queryByText('Fast')).toBeNull()
        rerender(view('composer-2.5[fast=true]'))
        expect(screen.getByText('Fast')).toBeVisible()
    })

    it('hides context usage on mobile and keeps the desktop detail order', async () => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        render(
            <I18nProvider>
                <StatusBar
                    active
                    thinking={false}
                    agentState={null}
                    contextSize={90_000}
                    contextCacheRead={86_000}
                    contextWindow={258_000}
                />
            </I18nProvider>
        )

        const connectionLabel = screen.getByLabelText('Готов')
        const leftStatusGroup = connectionLabel.parentElement?.parentElement
        const statusBar = leftStatusGroup?.parentElement
        const rightStatusGroup = statusBar?.lastElementChild
        expect(statusBar?.className.split(' ')).toContain('items-center')
        expect(leftStatusGroup?.className.split(' ')).toContain('items-center')
        expect(rightStatusGroup?.className.split(' ')).toContain('items-center')
        expect(leftStatusGroup?.className.split(' ')).toContain('gap-2')
        expect(leftStatusGroup?.className.split(' ')).not.toContain('sm:gap-3')
        expect(rightStatusGroup?.className.split(' ')).toContain('gap-2')

        const trigger = screen.getByRole('button', { name: '上下文详情' })
        expect(trigger.className.split(' ')).not.toContain('relative')
        expect(trigger.className.split(' ')).not.toContain('-top-px')
        expect(trigger.className.split(' ')).toContain('text-xs')
        expect(trigger.className.split(' ')).toContain('leading-4')
        expect(trigger.className.split(' ')).toContain('text-[#34C759]')
        expect(trigger.textContent).toBe('35% context')
        expect(trigger.className.split(' ')).toContain('hidden')
        expect(trigger.className.split(' ')).toContain('sm:inline-flex')

        fireEvent.click(trigger)

        const cacheLine = await screen.findByText('缓存：86k')
        const details = cacheLine.parentElement
        expect(details?.textContent).toBe('缓存：86k使用：90k（35%）剩余：168k（65%）')
        expect(screen.queryByText('上下文详情')).toBeNull()
    })

    it('localizes the popover content without localizing the external left label', async () => {
        localStorage.setItem('hapi-lang', 'en')
        render(
            <I18nProvider>
                <StatusBar
                    active
                    thinking={false}
                    agentState={null}
                    contextSize={90_000}
                    contextCacheRead={86_000}
                    contextWindow={258_000}
                />
            </I18nProvider>
        )

        const trigger = screen.getByRole('button', { name: 'Context details' })
        expect(trigger.textContent).toBe('35% context')

        fireEvent.click(trigger)

        const cacheLine = await screen.findByText('Cache: 86k')
        expect(cacheLine.parentElement?.textContent).toBe('Cache: 86kUsed: 90k (35%)Remaining: 168k (65%)')
    })
})
