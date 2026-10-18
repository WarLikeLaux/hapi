import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { describe, expect, it, vi } from 'vitest'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { buildVisibleChatBlocks } from '@/chat/toolGroups'
import type { NormalizedMessage } from '@/chat/types'
import type { DecryptedMessage, Session } from '@/types/api'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { ImagePreviewProvider } from '@/components/ImagePreview'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from './AssistantMessage'
import { HappySystemMessage } from './SystemMessage'

const session = { id: 'gallery-test', active: true, thinking: false } as Session
const api = { getGeneratedImageBlob: vi.fn(async () => new Blob(['image'], { type: 'image/png' })) }
const context = { api, sessionId: session.id, metadata: null, disabled: false,
    showSessionSummaryInChat: false, terminalToolDisplayMode: 'compact', onRefresh() {},
    hasMoreMessages: false, isSyncingTail: false, isLoadingMoreMessages: false,
    loadOlderMessagesPreservingScroll: async () => 'terminal-stop' } as unknown as HappyChatContextValue

// display_image emits separate agent records, joined into one answer by assistant-ui.
const row = (id: string, data: unknown): DecryptedMessage => ({ id, seq: 1, localId: null, createdAt: 1000,
    content: { role: 'agent', content: { type: 'codex', data } } } as DecryptedMessage)
const image = (id: string) => row(id, { type: 'generated-image', imageId: id, fileName: `${id}.png`, mimeType: 'image/png',
    source: { ingress: 'mcp', toolCallId: `display-${id}`, toolName: 'display_image' } })
const user = (id: string) => ({ id, seq: 1, localId: null, createdAt: 1000,
    content: { role: 'user', content: { type: 'text', text: id } } } as DecryptedMessage)
const messages = [user('request'), row('intro', { type: 'message', message: 'Six screenshots' }),
    ...Array.from({ length: 6 }, (_, i) => image(`shot-${i + 1}`)),
    user('next-request'), image('single')]

function Transcript({ rows, historyVersion = 0 }: { rows: DecryptedMessage[]; historyVersion?: number }) {
    const normalized = rows.map(normalizeDecryptedMessage).filter((m): m is NormalizedMessage => m !== null)
    const blocks = buildVisibleChatBlocks(reduceChatBlocks(normalized, null).blocks, { hasMoreMessages: false })
    const runtime = useHappyRuntime({ session, blocks, messagesVersion: rows.length, historyVersion,
        isSending: false, isRunning: false, onSendMessage: vi.fn(), onAbort: vi.fn(async () => {}) })
    return <I18nProvider><ImagePreviewProvider><HappyChatProvider value={context}><AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{ AssistantMessage: HappyAssistantMessage,
            UserMessage: () => null, SystemMessage: HappySystemMessage }} /></ThreadPrimitive.Root>
    </AssistantRuntimeProvider></HappyChatProvider></ImagePreviewProvider></I18nProvider>
}

describe('rendered assistant message gallery', () => {
    it('joins six display-image results, preserves selection through history/live updates, and isolates the next answer', async () => {
        const { container, rerender } = render(<Transcript rows={messages} />)
        await waitFor(() => expect(container.querySelectorAll('[data-image-preview-trigger]')).toHaveLength(7))
        expect(container.querySelectorAll('[data-hapi-message-role="assistant"]')).toHaveLength(2)
        fireEvent.click(container.querySelectorAll('[data-image-preview-trigger]')[3])
        expect(screen.getByText('4 / 6')).toBeVisible()
        expect(screen.getByRole('dialog')).toHaveAccessibleName('shot-4.png')
        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        expect(screen.getByText('3 / 6')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
        fireEvent.click(screen.getByTitle('Zoom in'))
        expect(screen.getByTitle('Reset zoom')).toHaveTextContent('125%')
        const expanded = [user('older-request'), image('older'), user('boundary'), ...messages,
            user('new-request'), image('new')]
        rerender(<Transcript rows={expanded} historyVersion={1} />)
        expect(screen.getByText('4 / 6')).toBeVisible()
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(screen.getByText('6 / 6')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled()
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(screen.getByRole('dialog')).toHaveAccessibleName('shot-6.png')
        fireEvent.keyDown(window, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).toBeNull()
        await waitFor(() => expect(container.querySelectorAll('[data-image-preview-trigger]')).toHaveLength(9))
        fireEvent.click(screen.getByRole('button', { name: 'single.png single.png' }))
        expect(screen.getByRole('dialog')).toHaveAccessibleName('single.png')
        expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull()
        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        expect(screen.getByRole('dialog')).toHaveAccessibleName('single.png')
        fireEvent.click(screen.getByTitle('Close'))
        fireEvent.click(screen.getByRole('button', { name: 'shot-2.png shot-2.png' }))
        expect(screen.getByText('2 / 6')).toBeVisible()
        expect(screen.getByTitle('Reset zoom')).toHaveTextContent('100%')
    })
})
