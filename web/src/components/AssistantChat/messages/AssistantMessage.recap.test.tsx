import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { describe, expect, it, vi } from 'vitest'
import { codexCases } from '../../../../scripts/fixtures/cases/codex'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { buildVisibleChatBlocks } from '@/chat/toolGroups'
import type { NormalizedMessage } from '@/chat/types'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import type { Session } from '@/types/api'
import { HappyAssistantMessage } from './AssistantMessage'
import { HappySystemMessage } from './SystemMessage'

const copy = vi.fn()
vi.mock('@/hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copied: false, copy }) }))

const session = { id: 'recap-test', active: true, thinking: false } as Session
const context = { api: {}, sessionId: session.id, metadata: null, disabled: false,
    showSessionSummaryInChat: false, terminalToolDisplayMode: 'compact', onRefresh() {},
    hasMoreMessages: false, isSyncingTail: false, isLoadingMoreMessages: false,
    loadOlderMessagesPreservingScroll: async () => 'terminal-stop' } as HappyChatContextValue
const messages = codexCases.find(test => test.name === 'codex-native-recap')!.messages

function Transcript({ count }: { count: number }) {
    const normalized = messages.slice(0, count).map(normalizeDecryptedMessage)
        .filter((message): message is NormalizedMessage => message !== null)
    const blocks = buildVisibleChatBlocks(reduceChatBlocks(normalized, null).blocks, { hasMoreMessages: false })
    const runtime = useHappyRuntime({ session, blocks, messagesVersion: count, historyVersion: 0,
        isSending: false, isRunning: false, onSendMessage: vi.fn(), onAbort: vi.fn(async () => {}) })
    return (
        <I18nProvider><HappyChatProvider value={context}><AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{
                AssistantMessage: HappyAssistantMessage, UserMessage: () => null, SystemMessage: HappySystemMessage
            }} /></ThreadPrimitive.Root>
        </AssistantRuntimeProvider></HappyChatProvider></I18nProvider>
    )
}

describe('Codex recap in the answer', () => {
    it('appends a readable recap to the answer, keeps it out of Show work, and preserves the next turn boundary', async () => {
        const { container, rerender } = render(<Transcript count={4} />)
        expect(await screen.findByText('Protocol checked.')).toBeVisible()
        expect(screen.queryByText('recap:')).toBeNull()
        rerender(<Transcript count={5} />)
        const recap = await screen.findByText('Checked the protocol.', { exact: false })
        const answer = recap.closest<HTMLElement>('[data-hapi-message-role="assistant"]')
        expect(answer).not.toBeNull()
        expect(container.querySelectorAll('[data-hapi-message-role="assistant"]')).toHaveLength(1)
        expect(within(answer!).getByText('Protocol checked.')).toBeVisible()
        expect(within(answer!).getByText('recap:')).toBeVisible()
        expect(within(answer!).getByRole('button', { name: /Show work/ })).toBeVisible()
        expect(screen.queryByText('Inspecting the protocol.')).toBeNull()
        fireEvent.click(within(answer!).getByRole('button', { name: 'Copy' }))
        expect(copy).toHaveBeenCalledWith('Protocol checked.\n\nrecap: Checked the protocol.\nNext: verify the UI.')
        rerender(<Transcript count={7} />)
        await waitFor(() => expect(container.querySelectorAll('[data-hapi-message-role="assistant"]')).toHaveLength(2))
        const newer = screen.getByText('UI checked.').closest('[data-hapi-message-role="assistant"]')!
        expect(within(newer as HTMLElement).queryByText('recap:')).toBeNull()
        expect(screen.getByText('Checked the protocol.', { exact: false }).closest('[data-hapi-message-role="assistant"]')).not.toBe(newer)
    })
})
