/** Session lifecycle: running, manually parked, or archived. Legacy idle
 * markers represent live sessions until the hub clears them. */

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
