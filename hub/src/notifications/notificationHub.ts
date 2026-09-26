import type { Session, SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { SessionEndReason } from '@hapi/protocol'
import type { NotificationChannel, NotificationHubOptions, TaskNotification } from './notificationTypes'
import type { NotificationSendContext } from './notificationSendContext'
import { extractMessageEventType, extractTaskNotification } from './eventParsing'

export class NotificationHub {
    private readonly channels: NotificationChannel[]
    private readonly readyCooldownMs: number
    private readonly permissionDebounceMs: number
    private readonly lastKnownRequests: Map<string, Set<string>> = new Map()
    private readonly notificationDebounce: Map<string, NodeJS.Timeout> = new Map()
    private readonly lastReadyNotificationAt: Map<string, number> = new Map()
    private unsubscribeSyncEvents: (() => void) | null = null

    constructor(
        private readonly syncEngine: SyncEngine,
        channels: NotificationChannel[],
        options?: NotificationHubOptions
    ) {
        this.channels = channels
        this.readyCooldownMs = options?.readyCooldownMs ?? 5000
        this.permissionDebounceMs = options?.permissionDebounceMs ?? 500
        this.unsubscribeSyncEvents = this.syncEngine.subscribe((event) => {
            this.handleSyncEvent(event)
        })
    }

    stop(): void {
        if (this.unsubscribeSyncEvents) {
            this.unsubscribeSyncEvents()
            this.unsubscribeSyncEvents = null
        }

        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer)
        }
        this.notificationDebounce.clear()
        this.lastKnownRequests.clear()
        this.lastReadyNotificationAt.clear()
    }

    private handleSyncEvent(event: SyncEvent): void {
        if ((event.type === 'session-updated' || event.type === 'session-added') && event.sessionId) {
            const session = this.syncEngine.getSession(event.sessionId)
            if (!session || !session.active) {
                this.clearSessionState(event.sessionId)
                return
            }
            this.checkForPermissionNotification(session)
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.clearSessionState(event.sessionId)
            return
        }

        if (event.type === 'session-ended' && event.sessionId) {
            if (event.reason === 'completed') {
                this.sendSessionCompletion(event.sessionId, event.reason).catch((error) => {
                    console.error('[NotificationHub] Failed to send session completion notification:', error)
                })
            }
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            const eventType = extractMessageEventType(event)
            if (eventType === 'ready') {
                this.sendReadyNotification(event.sessionId).catch((error) => {
                    console.error('[NotificationHub] Failed to send ready notification:', error)
                })
            }

            const taskNotification = extractTaskNotification(event)
            if (taskNotification) {
                this.sendTaskNotification(event.sessionId, taskNotification).catch((error) => {
                    console.error('[NotificationHub] Failed to send task notification:', error)
                })
            }
        }
    }

    private clearSessionState(sessionId: string): void {
        const existingTimer = this.notificationDebounce.get(sessionId)
        if (existingTimer) {
            clearTimeout(existingTimer)
            this.notificationDebounce.delete(sessionId)
        }
        this.lastKnownRequests.delete(sessionId)
        this.lastReadyNotificationAt.delete(sessionId)
    }

    private getNotifiableSession(sessionId: string): Session | null {
        const session = this.syncEngine.getSession(sessionId)
        if (!session || !session.active) {
            return null
        }
        return session
    }

    private checkForPermissionNotification(session: Session): void {
        const requests = session.agentState?.requests

        if (requests == null) {
            return
        }

        const newRequestIds = new Set(Object.keys(requests))
        const oldRequestIds = this.lastKnownRequests.get(session.id) || new Set()

        let hasNewRequests = false
        for (const requestId of newRequestIds) {
            if (!oldRequestIds.has(requestId)) {
                hasNewRequests = true
                break
            }
        }

        this.lastKnownRequests.set(session.id, newRequestIds)

        if (!hasNewRequests) {
            return
        }

        const existingTimer = this.notificationDebounce.get(session.id)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.notificationDebounce.delete(session.id)
            this.sendPermissionNotification(session.id).catch((error) => {
                console.error('[NotificationHub] Failed to send permission notification:', error)
            })
        }, this.permissionDebounceMs)

        this.notificationDebounce.set(session.id, timer)
    }

    private async sendPermissionNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        await this.notifyPermission(session)
    }

    private async sendReadyNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        // A persisted ready event only means the main turn ended. While
        // background tasks (async subagents, background shells) are still
        // outstanding the agent is not done: it will be woken again by each
        // task's completion. Staying quiet here leaves the session marked
        // working ("Background tasks running") and the final ready — after
        // the last task-notification zeroes the counter — announces it once,
        // truthfully. Checked before the cooldown stamp so the suppressed
        // ready cannot consume the next one's cooldown budget.
        if ((session.backgroundTaskCount ?? 0) > 0) {
            return
        }

        const now = Date.now()
        const last = this.lastReadyNotificationAt.get(sessionId) ?? 0
        if (now - last < this.readyCooldownMs) {
            return
        }
        this.lastReadyNotificationAt.set(sessionId, now)

        await this.notifyReady(session)
    }

    private async sendTaskNotification(sessionId: string, notification: TaskNotification): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        // Background-task completions arrive once per task, so a turn that
        // fanned out N subagents would ring every channel N times with
        // "Task completed". The truthful end-of-work signal is the ready
        // notification, which sendReadyNotification already holds back until
        // backgroundTaskCount drains. Success summaries are noise; only
        // failures are worth interrupting the operator for (the same policy
        // ServerChanChannel already applies).
        const normalizedStatus = notification.status?.trim().toLowerCase()
        const isFailure = normalizedStatus === 'failed'
            || normalizedStatus === 'error'
            || normalizedStatus === 'killed'
            || normalizedStatus === 'aborted'
        if (!isFailure) {
            return
        }

        await this.notifyTask(session, notification)
    }

    private async sendSessionCompletion(sessionId: string, reason: SessionEndReason): Promise<void> {
        const session = this.syncEngine.getSession(sessionId)
        if (!session) {
            return
        }

        await this.notifySessionCompletion(session, reason)
    }

    private async notifyReady(session: Session): Promise<void> {
        const ctx: NotificationSendContext = { nativeGate: { sent: false } }
        for (const channel of this.channels) {
            try {
                await channel.sendReady(session, ctx)
            } catch (error) {
                console.error('[NotificationHub] Failed to send ready notification:', error)
            }
        }
    }

    private async notifyPermission(session: Session): Promise<void> {
        const ctx: NotificationSendContext = { nativeGate: { sent: false } }
        for (const channel of this.channels) {
            try {
                await channel.sendPermissionRequest(session, ctx)
            } catch (error) {
                console.error('[NotificationHub] Failed to send permission notification:', error)
            }
        }
    }

    private async notifyTask(session: Session, notification: TaskNotification): Promise<void> {
        const ctx: NotificationSendContext = { nativeGate: { sent: false } }
        for (const channel of this.channels) {
            try {
                await channel.sendTaskNotification(session, notification, ctx)
            } catch (error) {
                console.error('[NotificationHub] Failed to send task notification:', error)
            }
        }
    }

    private async notifySessionCompletion(session: Session, reason: SessionEndReason): Promise<void> {
        for (const channel of this.channels) {
            if (typeof channel.sendSessionCompletion !== 'function') {
                continue
            }
            try {
                await channel.sendSessionCompletion(session, reason)
            } catch (error) {
                console.error('[NotificationHub] Failed to send session completion notification:', error)
            }
        }
    }
}
