import { StrictMode, useSyncExternalStore } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { AssistantRuntimeProvider, useAuiState } from '@assistant-ui/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/api'
import type { UserTextBlock } from '@/chat/types'
import { useHappyRuntime } from './assistant-runtime'

describe('assistant-ui composer snapshots', () => {
    it.each([false, true])('opens and replaces a bounded history window while running=%s', async (isRunning) => {
        const session = { id: 'history-window-test', active: true, thinking: false } as Session
        const block = (id: string): UserTextBlock => ({
            kind: 'user-text', id, localId: null, createdAt: 0, text: id
        })
        function Messages() {
            const messages = useAuiState(state => state.thread.messages)
            return <div data-testid="transcript">{messages.map(message => message.id).join(',')}</div>
        }
        function Transcript({ blocks, historyVersion }: { blocks: UserTextBlock[]; historyVersion: number }) {
            const runtime = useHappyRuntime({
                session,
                blocks,
                messagesVersion: historyVersion,
                historyVersion,
                isSending: false,
                isRunning,
                onSendMessage: vi.fn(),
                onAbort: vi.fn(async () => {}),
            })
            return <AssistantRuntimeProvider runtime={runtime}><Messages /></AssistantRuntimeProvider>
        }
        const { rerender } = render(<Transcript blocks={[]} historyVersion={0} />, { wrapper: StrictMode })
        rerender(<Transcript blocks={[block('m-3'), block('m-4')]} historyVersion={0} />)
        await waitFor(() => expect(screen.getByTestId('transcript')).toHaveTextContent('user-text:m-3,user-text:m-4'))
        rerender(<Transcript blocks={[block('m-1'), block('m-2')]} historyVersion={1} />)
        await waitFor(() => expect(screen.getByTestId('transcript')).toHaveTextContent('user-text:m-1,user-text:m-2'))
        expect(screen.getByTestId('transcript')).not.toHaveTextContent('user-text:m-3')
        expect(screen.getByTestId('transcript')).not.toHaveTextContent('user-text:m-4')
    })

    it('keeps snapshots stable and updates running state without a composer edit', async () => {
        const onSendMessage = vi.fn()
        const onAbort = vi.fn(async () => {})
        const session = { id: 'snapshot-test', active: true, thinking: false } as Session
        const { result, rerender } = renderHook(({ isRunning }) => {
            const runtime = useHappyRuntime({
                session,
                blocks: [],
                messagesVersion: 0,
                historyVersion: 0,
                isSending: false,
                isRunning,
                onSendMessage,
                onAbort,
            })
            const composer = runtime.thread.composer
            const snapshot = useSyncExternalStore(composer.subscribe, composer.getState)
            return { composer, snapshot }
        }, { initialProps: { isRunning: false }, wrapper: StrictMode })

        expect(result.current.snapshot.canCancel).toBe(false)
        expect(result.current.composer.getState()).toBe(result.current.snapshot)

        // Dictation and draft restoration both write through setText.
        act(() => result.current.composer.setText('dictated words'))
        expect(result.current.snapshot.text).toBe('dictated words')
        expect(result.current.composer.getState()).toBe(result.current.snapshot)

        rerender({ isRunning: true })
        expect(result.current.snapshot.canCancel).toBe(true)
        expect(result.current.snapshot.text).toBe('dictated words')
        rerender({ isRunning: false })
        expect(result.current.snapshot.canCancel).toBe(false)

        await act(async () => result.current.composer.send())
        expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('dictated words', undefined, null, 'default')
        expect(result.current.snapshot.text).toBe('')
        expect(result.current.composer.getState()).toBe(result.current.snapshot)
    })
})
