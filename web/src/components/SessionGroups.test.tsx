import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { getSessionLastSeenAt, markSessionUnread } from '@/lib/sessionLastSeen'
import { useSelectedSessionSeen } from '@/hooks/useSelectedSessionSeen'
import { SessionGroupWorkspace } from './SessionGroups'

const group: SessionGroup = { id: 'group', name: 'HAPI', version: 1, updatedAt: 1,
    members: [{ sessionId: 'first', pinned: true }, { sessionId: 'worker', pinned: false }] }
const chats = (thinking: boolean, extra: Partial<SessionSummary> = {}): SessionSummary[] => ['first', 'worker'].map(id => ({
    id, active: true, thinking: id === 'worker' && thinking, lastAgentMessageAt: 2000, updatedAt: 2000,
    metadata: { path: '/work', name: id, flavor: 'codex' }, metadataVersion: 1, agentStateVersion: 1,
    activeAt: 1, todosUpdatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [],
    backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null,
    ...(id === 'worker' ? extra : {}),
}))
function Workspace({ sessions }: { sessions: SessionSummary[] }) {
    const [selected, select] = useState('first')
    useSelectedSessionSeen(selected, sessions.find(s => s.id === selected)?.lastAgentMessageAt)
    return <I18nProvider><SessionGroupWorkspace group={group} groups={[group]} sessions={sessions} selectedSessionId={selected}
        onSelect={select} onBack={vi.fn()} onNew={vi.fn()} onUpdate={vi.fn()} pending={false} /></I18nProvider>
}
const worker = () => screen.getByRole('tab', { name: /^worker/ })
beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ first: 2000, worker: 1000 }))
    Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('group tab attention', () => {
    it('preserves unread history across work, completion and page reopening until the tab is opened', () => {
        const view = render(<Workspace sessions={chats(true)} />)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        expect(getSessionLastSeenAt('worker')).toBe(1000)
        view.unmount()
        const reopened = render(<Workspace sessions={chats(true)} />)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        reopened.rerender(<Workspace sessions={chats(false)} />)
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
        reopened.unmount()
        render(<Workspace sessions={chats(false)} />)
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
        fireEvent.click(worker())
        expect(getSessionLastSeenAt('worker')).toBe(2000)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
    })

    it('keeps an open tab read through work and completion, while preserving an explicit mark unread', () => {
        const view = render(<Workspace sessions={chats(true)} />)
        fireEvent.click(worker())
        view.rerender(<Workspace sessions={chats(false, { lastAgentMessageAt: 3000 })} />)
        expect(getSessionLastSeenAt('worker')).toBe(3000)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        act(() => markSessionUnread('worker', 3000))
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
    })

    it.each([
        ['input', 0, 'Waiting for answer'], ['input', 1, 'Question'], ['permission', 0, 'Permission required'],
    ] as const)('keeps %s attention visible during work and in the selected tab', (kind, asyncCount, label) => {
        render(<Workspace sessions={chats(true, { pendingRequestKinds: [kind], pendingRequestsCount: 1, pendingAsyncQuestionsCount: asyncCount })} />)
        expect(within(worker()).getByLabelText(label)).toBeVisible()
        fireEvent.click(worker())
        expect(within(worker()).getByLabelText(label)).toBeVisible()
    })
})
