import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { useGroupSessionCloseNavigation } from './useGroupSessionCloseNavigation'

const chat = (id = 'current', state = 'running', active = true) => ({
    id, active, metadata: { lifecycleState: state },
}) as SessionSummary
const group = (id = 'origin', members = ['current']): SessionGroup => ({
    id, name: id, members: members.map(sessionId => ({ sessionId, pinned: false })), version: 1, updatedAt: 0,
})
const initial = () => ({ scope: 'hub', sessionId: 'current' as string | null,
    session: chat() as SessionSummary | null, groups: [group()] })
function mount(props = initial()) {
    const onReturnToGroup = vi.fn()
    const view = renderHook(input => useGroupSessionCloseNavigation({ ...input, onReturnToGroup }), { initialProps: props })
    return { ...view, onReturnToGroup }
}

describe('return from a closed group chat', () => {
    it.each(['membership-first', 'archive-first'] as const)('retains the source group with %s delivery and returns once', order => {
        const view = mount()
        if (order === 'membership-first') {
            view.rerender({ ...initial(), groups: [group('origin', [])] })
            expect(view.onReturnToGroup).not.toHaveBeenCalled()
        }
        view.rerender({ ...initial(), session: chat('current', 'archived', false),
            groups: [group('origin', order === 'membership-first' ? [] : ['current'])] })
        expect(view.onReturnToGroup.mock.calls).toEqual([['origin']])
        view.rerender({ ...initial(), session: chat('current', 'archived', false), groups: [group('origin', [])] })
        expect(view.onReturnToGroup).toHaveBeenCalledTimes(1)
    })

    it('keeps transiently disconnected, idle and parked chats open until they are archived', () => {
        const view = mount()
        for (const state of ['running', 'idle', 'parked']) {
            view.rerender({ ...initial(), session: chat('current', state, false) })
            expect(view.onReturnToGroup).not.toHaveBeenCalled()
        }
        view.rerender({ ...initial(), session: chat('current', 'archived', false) })
        expect(view.onReturnToGroup.mock.calls).toEqual([['origin']])
    })

    it('allows initial archived-history links even with stale membership and later refreshes', () => {
        const view = mount({ ...initial(), session: chat('current', 'archived', false) })
        view.rerender({ ...initial(), session: chat('current', 'archived', false), groups: [group('origin', [])] })
        expect(view.onReturnToGroup).not.toHaveBeenCalled()
    })

    it('does not follow a previous chat after the user navigates away or opens another group', () => {
        const view = mount()
        view.rerender({ ...initial(), sessionId: 'other', session: chat('other'), groups: [group(), group('second', ['other'])] })
        view.rerender({ ...initial(), sessionId: 'other', session: chat('other'), groups: [group('origin', []), group('second', ['other'])] })
        expect(view.onReturnToGroup).not.toHaveBeenCalled()
        view.rerender({ ...initial(), sessionId: 'other', session: chat('other', 'archived', false), groups: [group('origin', []), group('second', [])] })
        expect(view.onReturnToGroup.mock.calls).toEqual([['second']])
        view.rerender({ ...initial(), sessionId: null, session: null })
        view.rerender({ ...initial(), session: chat('current', 'archived', false) })
        expect(view.onReturnToGroup).toHaveBeenCalledTimes(1)
    })

    it('follows the current group after a chat is moved, and never navigates to a deleted group', () => {
        const view = mount()
        view.rerender({ ...initial(), groups: [group('origin', []), group('moved')] })
        view.rerender({ ...initial(), session: chat('current', 'archived', false), groups: [group('origin', []), group('moved', [])] })
        expect(view.onReturnToGroup.mock.calls).toEqual([['moved']])
        const deleted = mount()
        deleted.rerender({ ...initial(), session: chat('current', 'archived', false), groups: [] })
        expect(deleted.onReturnToGroup).not.toHaveBeenCalled()
    })

    it('does not reuse another hub or standalone chat history', () => {
        const view = mount()
        view.rerender({ ...initial(), scope: 'another-hub', session: chat('current', 'archived', false), groups: [group('origin', [])] })
        expect(view.onReturnToGroup).not.toHaveBeenCalled()
        const standalone = mount({ ...initial(), groups: [group('origin', [])] })
        standalone.rerender({ ...initial(), session: chat('current', 'archived', false), groups: [group('origin', [])] })
        expect(standalone.onReturnToGroup).not.toHaveBeenCalled()
    })
})
