import { describe, expect, it, mock, spyOn } from 'bun:test'
import { HappyBot } from './bot'
import type { SyncEngine } from '../sync/syncEngine'
import type { Store } from '../store'
import { VisibilityTracker } from '../visibility/visibilityTracker'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeStore(chatIds: number[] = []): Store {
    return {
        users: {
            getUsersByPlatformAndNamespace: () => chatIds.map(chatId => ({ platformUserId: String(chatId) })),
            getUser: () => null
        }
    } as unknown as Store
}

function createBot(options: { chatIds?: number[]; visibilityTracker?: VisibilityTracker } = {}) {
    const bot = new HappyBot({
        syncEngine: {} as unknown as SyncEngine,
        botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        publicUrl: 'https://example.com',
        store: createFakeStore(options.chatIds),
        visibilityTracker: options.visibilityTracker ?? new VisibilityTracker()
    })
    return bot
}

describe('HappyBot.start', () => {
    it('logs error and resets isRunning when polling fails', async () => {
        const bot = createBot()
        const innerBot = bot.getBot()

        // Override bot.start to simulate a polling failure
        innerBot.start = mock((): Promise<void> => Promise.reject(new Error('Network failure')))

        const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

        await bot.start()
        // Allow microtask (.catch handler) to run
        await sleep(10)

        expect(errorSpy).toHaveBeenCalledWith(
            '[HAPIBot] Telegram bot polling failed:',
            'Network failure'
        )

        // isRunning should be reset, so start() should work again
        await bot.start()
        expect(innerBot.start).toHaveBeenCalledTimes(2)

        errorSpy.mockRestore()
    })

    it('does not call bot.start twice when already running', async () => {
        const bot = createBot()
        const innerBot = bot.getBot()

        // Simulate a long-running polling that never resolves
        innerBot.start = mock((): Promise<void> => new Promise(() => {}))

        await bot.start()
        await bot.start() // second call should be no-op

        expect(innerBot.start).toHaveBeenCalledTimes(1)
    })
})

describe('HappyBot session visibility', () => {
    const session = {
        id: 'session-1',
        namespace: 'default',
        active: true,
        metadata: null
    } as Parameters<HappyBot['sendReady']>[0]

    it('suppresses Telegram when the same session chat is visible', async () => {
        const visibilityTracker = new VisibilityTracker()
        visibilityTracker.registerConnection('chat', 'default', 'visible', session.id)
        const bot = createBot({ chatIds: [123], visibilityTracker })
        const sendMessage = mock(async () => ({}))
        bot.getBot().api.sendMessage = sendMessage as never

        await bot.sendReady(session)

        expect(sendMessage).not.toHaveBeenCalled()
    })

    it('sends Telegram when the list, another chat, or a hidden chat is open', async () => {
        const visibilityTracker = new VisibilityTracker()
        visibilityTracker.registerConnection('list', 'default', 'visible')
        visibilityTracker.registerConnection('other-chat', 'default', 'visible', 'session-2')
        visibilityTracker.registerConnection('hidden-chat', 'default', 'hidden', session.id)
        const bot = createBot({ chatIds: [123], visibilityTracker })
        const sendMessage = mock(async () => ({}))
        bot.getBot().api.sendMessage = sendMessage as never

        await bot.sendReady(session)

        expect(sendMessage).toHaveBeenCalledTimes(1)
    })
})
