/**
 * `metadata.lifecycleState` vocabulary.
 *
 * Two different liveness signals travel on a Session and they answer
 * different questions (tiann/hapi#1820):
 *
 * - `active` / `activeAt` — **transport** liveness. The CLI socket is
 *   connected and its `session-alive` keepalive is landing. It says nothing
 *   about whether the agent behind that socket is doing, or has recently
 *   done, any work.
 * - `metadata.lifecycleState` — **agent** liveness. `running` while the
 *   session is a live working session, `idle` once the hub has observed
 *   keepalives with no agent progress for the configured window, `archived`
 *   once the session is closed.
 *
 * `idle` is a reversible, non-destructive marker: the session stays `active`
 * (its CLI really is reachable and a turn would be served immediately), it is
 * simply flagged as keepalive-only so operators and the session list can tell
 * a working fleet from a pile of zombies.
 *
 * `parked` is the stopped-but-listed state: the agent process is killed and
 * the session is `active: false` (freed from memory), but unlike `archived`
 * the row stays visible in the session list and can be resumed with reopen.
 */

export const SESSION_LIFECYCLE_RUNNING = 'running'
export const SESSION_LIFECYCLE_IDLE = 'idle'
export const SESSION_LIFECYCLE_PARKED = 'parked'
export const SESSION_LIFECYCLE_ARCHIVED = 'archived'

/**
 * True for the lifecycle values that mean "a CLI still owns this session".
 *
 * Call sites that used to compare against `'running'` literally must use this
 * instead, otherwise a session that the hub reconciled to `idle` reads as a
 * dead row and becomes eligible for archive-as-stale / migrate-over paths.
 */
export function isLiveLifecycleState(value: unknown): boolean {
    return value === SESSION_LIFECYCLE_RUNNING || value === SESSION_LIFECYCLE_IDLE
}

/**
 * True for `parked`: process stopped (`active: false`) but still listed and
 * resumable via reopen — unlike `archived`, which leaves the list.
 */
export function isParkedLifecycleState(value: unknown): boolean {
    return value === SESSION_LIFECYCLE_PARKED
}
