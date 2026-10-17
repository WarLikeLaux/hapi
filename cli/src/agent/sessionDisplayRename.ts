import type { ApiSessionClient } from '@/api/apiSession';
import type { Metadata } from '@/api/types';

type SessionDisplayRenameClient = Pick<ApiSessionClient, 'updateMetadata'>;

/**
 * Agent rename: preserve user-set and pinned names. Pin requests also mark
 * the versioned metadata write for the hub to establish ownership. Native/generated
 * summaries must not overwrite an intentional name.
 */
export function normalizeSessionDisplayTitle(title: unknown): string | null {
    if (typeof title !== 'string') {
        return null;
    }
    const normalized = title.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

export function applySessionDisplayRename(
    client: SessionDisplayRenameClient,
    title: unknown,
    options?: { pin?: boolean }
): boolean {
    const normalized = normalizeSessionDisplayTitle(title);
    if (!normalized) {
        return false;
    }

    client.updateMetadata((metadata: Metadata) => {
        if (metadata.nameLock || (metadata.name?.trim() === normalized && !options?.pin)) {
            return metadata;
        }
        return {
            ...metadata,
            name: normalized,
            ...(options?.pin ? { nameLock: 'agent' as const } : {})
        };
    }, options?.pin ? { pinTitle: true } : undefined);
    return true;
}
