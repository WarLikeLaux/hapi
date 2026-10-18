import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { buildVisibleChatBlocks } from '@/chat/toolGroups'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import type { Session } from '@/types/api'
import { HappyAssistantMessage } from './AssistantMessage'

const session = { id: 'questions-test', active: true, thinking: false } as Session
const context = {
    api: {}, sessionId: session.id, metadata: { flavor: 'codex' }, disabled: false,
    showSessionSummaryInChat: false, terminalToolDisplayMode: 'compact', onRefresh() {},
    hasMoreMessages: false, isSyncingTail: false, isLoadingMoreMessages: false,
    loadOlderMessagesPreservingScroll: async () => 'terminal-stop',
} as HappyChatContextValue

function prose(id: string, text: string): ChatBlock {
    return { kind: 'agent-text', id, localId: null, createdAt: 1, text }
}

function tool(name: string, pending = false): ToolCallBlock {
    return {
        kind: 'tool-call', id: name, localId: null, createdAt: 1, children: [],
        tool: {
            id: name, name, state: pending ? 'pending' : 'completed',
            input: { questions: [{ id: 'choice', question: 'Choose a release target', options: [{ label: 'Preview' }] }] },
            createdAt: 1, startedAt: 1, completedAt: pending ? null : 2,
            execStartedAt: null, execCompletedAt: null, description: null,
            ...(pending ? { permission: { id: name, status: 'pending' as const } } : {}),
        },
    }
}

function Transcript({ blocks, running = false }: { blocks: ChatBlock[]; running?: boolean }) {
    const runtime = useHappyRuntime({ session, blocks: buildVisibleChatBlocks(blocks, { hasMoreMessages: false }),
        messagesVersion: blocks.length, historyVersion: 0, isSending: false, isRunning: running,
        onSendMessage: vi.fn(), onAbort: vi.fn(async () => {}) })
    return (
        <I18nProvider><HappyChatProvider value={context}><AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{
                AssistantMessage: HappyAssistantMessage, UserMessage: () => <div>User answered</div>,
            }} /></ThreadPrimitive.Root>
        </AssistantRuntimeProvider></HappyChatProvider></I18nProvider>
    )
}

describe('Questions outside Show work', () => {
    it('keeps public prose through streaming, completion, a reply and history reopening without duplicating it in work', async () => {
        const blocks = [
            { kind: 'agent-reasoning', id: 'reason', localId: null, createdAt: 1, text: 'Private investigation' },
            prose('question', 'Please confirm the target before I continue.'),
            tool('Read'),
            prose('later', 'I checked the configuration while waiting.'),
        ] satisfies ChatBlock[]
        const { rerender, unmount } = render(<Transcript blocks={blocks} running />)
        expect(await screen.findByText('Please confirm the target before I continue.')).toBeVisible()
        rerender(<Transcript blocks={blocks} />)
        expect(await screen.findByRole('button', { name: /Show work/ })).toBeVisible()
        expect(screen.getByText('Please confirm the target before I continue.')).toBeVisible()
        expect(screen.queryByText('Private investigation')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Show work/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText('Private investigation')).toBeVisible()
        expect(within(dialog).queryByText('Please confirm the target before I continue.')).toBeNull()
        fireEvent.keyDown(dialog, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        const replied = [...blocks,
            { kind: 'user-text', id: 'reply', localId: null, createdAt: 3, text: 'Confirmed' } as ChatBlock,
            prose('done', 'Proceeding with the confirmed target.'),
        ]
        rerender(<Transcript blocks={replied} />)
        expect(await screen.findByText('User answered')).toBeVisible()
        expect(screen.getAllByText('Please confirm the target before I continue.')).toHaveLength(1)
        unmount()
        render(<Transcript blocks={replied} />)
        expect(await screen.findByText('Please confirm the target before I continue.')).toBeVisible()
        expect(screen.queryByText(/waiting for approval/i)).toBeNull()
    })

    it.each(['AskUserQuestion', 'ask_user_question', 'CursorAskQuestion', 'ask_user', 'request_user_input', 'request_user_input_async']) (
        'keeps the %s card outside work after later prose arrives', async (name) => {
            const blocks = [tool('Read'), tool(name, name !== 'request_user_input_async'), prose('later', 'Configuration checked.')]
            const { container } = render(<Transcript blocks={blocks} />)
            expect(await screen.findByRole('button', { name: /Show work/ })).toBeVisible()
            expect(container.querySelectorAll('[id^="hapi-question:"]')).toHaveLength(1)
            expect(container.querySelector('[id^="hapi-question:"]')).toBeVisible()
        }
    )

    it('retains the async question and its recorded answer without reviving the form on remount', async () => {
        const question = tool('request_user_input_async')
        const blocks = [tool('Read'), question, prose('later', 'Configuration checked.')]
        const { rerender, unmount } = render(<Transcript blocks={blocks} />)
        expect(await screen.findByRole('button', { name: /Preview/ })).toBeVisible()
        const answered = { ...question, tool: { ...question.tool, result: { answers: { choice: { answers: ['Preview'] } } } } }
        const history = [blocks[0], answered, blocks[2]]
        rerender(<Transcript blocks={history} />)
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull())
        expect(screen.getByText('Preview')).toBeVisible()
        unmount()
        render(<Transcript blocks={history} />)
        expect(await screen.findByText('Preview')).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    })
})
