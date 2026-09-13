/**
 * Telegram Bot for HAPI
 *
 * Simplified bot that only handles notifications (permission requests and ready events).
 * All interactive features are handled by the Telegram Mini App.
 */

import { Bot, Context, InlineKeyboard } from 'grammy'
import { SyncEngine, Session, type Machine } from '../sync/syncEngine'
import { handleCallback, CallbackContext } from './callbacks'
import {
    buildSessionLink,
    createNotificationKeyboard,
    formatReadyNotification,
    formatSessionNotification
} from './sessionView'
import { getAgentName } from '../notifications/sessionInfo'
import type { NotificationChannel, TaskNotification } from '../notifications/notificationTypes'
import type { Store } from '../store'

export interface BotContext extends Context {
    // Extended context for future use
}

export interface HappyBotConfig {
    syncEngine: SyncEngine
    botToken: string
    publicUrl: string
    store: Store
}

/**
 * HAPI Telegram Bot - Notification-only mode
 */
export class HappyBot implements NotificationChannel {
    private bot: Bot<BotContext>
    private syncEngine: SyncEngine | null = null
    private isRunning = false
    private readonly publicUrl: string
    private readonly store: Store

    constructor(config: HappyBotConfig) {
        this.syncEngine = config.syncEngine
        this.publicUrl = config.publicUrl
        this.store = config.store

        this.bot = new Bot<BotContext>(config.botToken)
        this.setupMiddleware()
        this.setupCommands()
        this.setupCallbacks()

        if (this.syncEngine) {
            this.setSyncEngine(this.syncEngine)
        }
    }

    /**
     * Update the sync engine reference (after auth)
     */
    setSyncEngine(engine: SyncEngine): void {
        this.syncEngine = engine
    }

    /**
     * Get the underlying bot instance
     */
    getBot(): Bot<BotContext> {
        return this.bot
    }

    /**
     * Start the bot
     */
    async start(): Promise<void> {
        if (this.isRunning) return

        console.log('[HAPIBot] Starting Telegram bot...')
        this.isRunning = true

        // Start polling (long-running, resolves when polling stops)
        this.bot.start({
            onStart: (botInfo) => {
                console.log(`[HAPIBot] Bot @${botInfo.username} started`)
            }
        }).catch((error) => {
            this.isRunning = false
            console.error('[HAPIBot] Telegram bot polling failed:', error instanceof Error ? error.message : error)
        })
    }

    /**
     * Stop the bot
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return

        console.log('[HAPIBot] Stopping Telegram bot...')

        await this.bot.stop()
        this.isRunning = false
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // Error handling middleware
        this.bot.catch((err) => {
            console.error('[HAPIBot] Error:', err.message)
        })
    }

    /**
     * Setup command handlers
     */
    private setupCommands(): void {
        // /app - Open Telegram Mini App (primary entry point)
        this.bot.command('app', async (ctx) => {
            await ctx.reply(`Open HAPI:\n${this.publicUrl}`)
        })

        // /start - Simple welcome with Mini App link
        this.bot.command('start', async (ctx) => {
            await ctx.reply(
                'Welcome to HAPI Bot!\n\n' +
                'Open HAPI for full session management:\n' +
                this.publicUrl
            )
        })
    }

    /**
     * Setup callback query handlers for notification buttons
     */
    private setupCallbacks(): void {
        this.bot.on('callback_query:data', async (ctx) => {
            if (!this.syncEngine) {
                await ctx.answerCallbackQuery('Not connected')
                return
            }

            const namespace = this.getNamespaceForChatId(ctx.from?.id ?? null)
            if (!namespace) {
                await ctx.answerCallbackQuery('Telegram account is not bound')
                return
            }

            const data = ctx.callbackQuery.data

            const callbackContext: CallbackContext = {
                syncEngine: this.syncEngine,
                namespace,
                answerCallback: async (text?: string) => {
                    await ctx.answerCallbackQuery(text)
                },
                editMessage: async (text, keyboard) => {
                    await ctx.editMessageText(text, {
                        reply_markup: keyboard
                    })
                }
            }

            await handleCallback(data, callbackContext)
        })
    }

    /**
     * Get bound Telegram chat IDs from storage.
     */
    private getBoundChatIds(namespace: string): number[] {
        const users = this.store.users.getUsersByPlatformAndNamespace('telegram', namespace)
        const ids = new Set<number>()
        for (const user of users) {
            const chatId = Number(user.platformUserId)
            if (Number.isFinite(chatId)) {
                ids.add(chatId)
            }
        }
        return Array.from(ids)
    }

    private getNamespaceForChatId(chatId: number | null | undefined): string | null {
        if (!chatId) {
            return null
        }
        const stored = this.store.users.getUser('telegram', String(chatId))
        return stored?.namespace ?? null
    }

    private getSessionMachine(session: Session): Machine | undefined {
        if (!this.syncEngine) {
            return undefined
        }

        const machineId = session.metadata?.machineId
        if (machineId) {
            const machine = this.syncEngine.getMachineByNamespace(machineId, session.namespace)
            if (machine) {
                return machine
            }
        }

        const host = session.metadata?.host
        if (!host) {
            return undefined
        }

        return this.syncEngine.getMachinesByNamespace(session.namespace)
            .find((machine) => machine.metadata?.host === host)
    }

    /**
     * Send a notification when agent is ready for input.
     */
    async sendReady(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const text = appendSessionLink(
            formatReadyNotification(session, this.getSessionMachine(session)),
            this.publicUrl,
            session.id
        )

        const chatIds = this.getBoundChatIds(session.namespace)
        if (chatIds.length === 0) {
            return
        }

        for (const chatId of chatIds) {
            try {
                await this.bot.api.sendMessage(
                    chatId,
                    text
                )
            } catch (error) {
                console.error(`[HAPIBot] Failed to send ready notification to chat ${chatId}:`, error)
            }
        }
    }

    /**
     * Send permission notification to all bound chats
     */
    async sendPermissionRequest(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const text = appendSessionLink(
            formatSessionNotification(session, this.getSessionMachine(session)),
            this.publicUrl,
            session.id
        )
        const keyboard = createNotificationKeyboard(session)

        const chatIds = this.getBoundChatIds(session.namespace)
        if (chatIds.length === 0) {
            return
        }

        for (const chatId of chatIds) {
            try {
                await this.bot.api.sendMessage(
                    chatId,
                    text,
                    keyboard ? { reply_markup: keyboard } : undefined
                )
            } catch (error) {
                console.error(`[HAPIBot] Failed to send notification to chat ${chatId}:`, error)
            }
        }
    }

    async sendTaskNotification(session: Session, notification: TaskNotification): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const status = notification.status?.trim().toLowerCase()
        const prefix = status === 'failed' || status === 'error' || status === 'killed' || status === 'aborted'
            ? 'Task failed'
            : 'Task completed'
        const text = appendSessionLink(
            `${prefix}\n\n${agentName}: ${notification.summary}`,
            this.publicUrl,
            session.id
        )
        const chatIds = this.getBoundChatIds(session.namespace)
        if (chatIds.length === 0) {
            return
        }

        for (const chatId of chatIds) {
            try {
                await this.bot.api.sendMessage(chatId, text)
            } catch (error) {
                console.error(`[HAPIBot] Failed to send task notification to chat ${chatId}:`, error)
            }
        }
    }
}

function appendSessionLink(text: string, publicUrl: string, sessionId: string): string {
    return `${text}\n\n${buildSessionLink(publicUrl, sessionId)}`
}
