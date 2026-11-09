import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import { ToolDetailDialogContent } from '@/components/ToolCard/ToolCard'
import { I18nProvider } from '@/lib/i18n-context'

function show(input: unknown, result?: unknown) {
    const block: ToolCallBlock = {
        kind: 'tool-call', id: 'patch', localId: null, createdAt: 1000, children: [],
        tool: { id: 'patch', name: 'CodexPatch', state: 'completed', input, result,
            createdAt: 1000, startedAt: 1000, completedAt: 1100, execStartedAt: null, execCompletedAt: null, description: null }
    }
    render(<I18nProvider><ToolDetailDialogContent block={block} metadata={null} /></I18nProvider>)
}

describe('Apply changes details', () => {
    it('shows the completed changes for files outside Git', () => {
        show({ changes: [{ path: '/tmp/notes.txt', diff: '' }] }, {
            success: true, changes: { '/tmp/notes.txt': { type: 'update', unified_diff: '@@ -1 +1 @@\n-before\n+after' } }
        })
        expect(screen.getByText('/tmp/notes.txt')).toBeInTheDocument()
        expect(screen.getByText('-before')).toBeInTheDocument()
        expect(screen.getByText('+after')).toBeInTheDocument()
    })

    it('shows the saved patch from older hook messages', () => {
        show({ patch: '*** Begin Patch\n*** Add File: /tmp/new.txt\n+hello\n*** End Patch' })
        expect(screen.getByText('+hello')).toBeInTheDocument()
        expect(screen.getByText('Proposed patch')).toBeInTheDocument()
    })
})
