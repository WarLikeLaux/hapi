export type SessionHeaderSecondaryMetadataKey =
    | 'model'
    | 'reasoning'
    | 'branch'
    | 'machine'
    | 'lastActive'
    | 'updatedAt'
    | 'createdAt'
    | 'worktree'
    | 'fastMode'

const MOBILE_SECONDARY_PRIORITY: ReadonlyArray<SessionHeaderSecondaryMetadataKey> = [
    'branch',
    'machine',
    'lastActive',
    'model',
    'reasoning',
    'fastMode',
    'createdAt',
    'updatedAt',
    'worktree',
]

export function selectMobileSessionHeaderSecondary(
    available: Partial<Record<SessionHeaderSecondaryMetadataKey, boolean>>
): SessionHeaderSecondaryMetadataKey | null {
    return MOBILE_SECONDARY_PRIORITY.find((key) => available[key] === true) ?? null
}
