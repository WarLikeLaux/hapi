import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { useNewSessionNavigation } from './useNewSessionNavigation'

let frames: FrameRequestCallback[]

beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn())
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
    const completions: Array<(id: string) => void> = []
    function NewSession() {
        const open = useNewSessionNavigation()
        return <button onClick={() => completions.push(open)}>Launch</button>
    }
    const root = createRootRoute({ component: Outlet })
    const list = createRoute({ getParentRoute: () => root, path: '/sessions', component: () => <div>Chat list</div> })
    const launch = createRoute({ getParentRoute: () => root, path: '/sessions/new', component: NewSession })
    const chat = createRoute({ getParentRoute: () => root, path: '/sessions/$sessionId', component: () => <div>Chat</div> })
    const history = createMemoryHistory({ initialEntries: ['/sessions/previous', '/sessions/new'] })
    const router = createRouter({ routeTree: root.addChildren([list, launch, chat]), history, defaultPendingMinMs: 0 })
    render(<RouterProvider router={router} />)
    await screen.findByRole('button', { name: 'Launch' })
    const start = () => act(() => screen.getByRole('button', { name: 'Launch' }).click())
    const complete = async (index: number, id: string) => {
        await act(async () => { completions[index](id) })
        await act(async () => { const pending = frames.splice(0); pending.forEach(callback => callback(0)) })
    }
    const go = async (direction: 'back' | 'forward', pathname: string) => {
        await act(async () => { history[direction]() })
        await waitFor(() => expect(router.state.location.pathname).toBe(pathname))
    }
    return { history, router, start, complete, go, completions }
}

describe('completed new-session navigation', () => {
    it('opens a launch the user waited for and keeps the chat list as its back destination', async () => {
        const view = await setup()
        view.start()
        await view.complete(0, 'created')
        expect(view.history.location.pathname).toBe('/sessions/created')
        await view.go('back', '/sessions')
        await view.go('forward', '/sessions/created')
    })

    it.each(['link', 'back', 'back-forward'] as const)('respects navigation by %s before completion', async navigation => {
        const view = await setup()
        view.start()
        if (navigation === 'link') {
            await act(async () => { await view.router.navigate({ to: '/sessions/$sessionId', params: { sessionId: 'chosen' } }) })
        } else {
            await view.go('back', '/sessions/previous')
            if (navigation === 'back-forward') await view.go('forward', '/sessions/new')
        }
        const selected = view.history.location.href
        await view.complete(0, 'created')
        expect(view.history.location.href).toBe(selected)
    })

    it('allows the current launch to open even if an earlier launch completes afterward', async () => {
        const view = await setup()
        view.start()
        await view.go('back', '/sessions/previous')
        await view.go('forward', '/sessions/new')
        view.start()
        await view.complete(1, 'second')
        await view.complete(0, 'first')
        expect(view.history.location.pathname).toBe('/sessions/second')
    })

    it('respects navigation between clearing the launch page and the deferred chat opening', async () => {
        const view = await setup()
        view.start()
        await act(async () => { view.completions[0]('created') })
        await act(async () => { await view.router.navigate({ to: '/sessions/$sessionId', params: { sessionId: 'chosen' } }) })
        await act(async () => { frames.splice(0).forEach(callback => callback(0)) })
        expect(view.history.location.pathname).toBe('/sessions/chosen')
    })
})
