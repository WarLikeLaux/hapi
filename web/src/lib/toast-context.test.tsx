import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from '@/lib/toast-context'

const repeatedToast = {
    title: 'Permission Request',
    body: 'Run command',
    sessionId: 'session-1',
    url: '/sessions/session-1',
    dedupeKey: 'permission:session-1:run-command',
}

function Harness() {
    const { toasts, addToast, dismissToast } = useToast()
    return (
        <>
            <button type="button" onClick={() => addToast(repeatedToast)}>add</button>
            {toasts.map((toast) => (
                <button key={toast.id} type="button" onClick={() => dismissToast(toast.id)}>
                    {toast.body}
                </button>
            ))}
        </>
    )
}

describe('ToastProvider', () => {
    it('suppresses a repeated SSE toast after manual dismissal', () => {
        render(<ToastProvider><Harness /></ToastProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'add' }))
        fireEvent.click(screen.getByRole('button', { name: 'Run command' }))
        expect(screen.queryByRole('button', { name: 'Run command' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'add' }))
        expect(screen.queryByRole('button', { name: 'Run command' })).not.toBeInTheDocument()
    })
})
