import type { OpencodePermissionMode } from '@hapi/protocol/types';
import type { PreparedImageContent } from '@/modules/common/attachmentImages';

export type PermissionMode = OpencodePermissionMode;

/**
 * An image attachment prepared for the prompt, keeping its source upload path
 * so queued items with different attachment sets never batch together (the
 * launcher only sees `mode` of the batch's first item).
 */
export interface OpencodePreparedImage extends PreparedImageContent {
    path: string;
}

export interface OpencodeMode {
    permissionMode: PermissionMode;
    // `string` is a specific model id; `null` means "reset to the backend's
    // launch-time default" (e.g. after `/model default`); `undefined` means
    // "no change requested for this batch".
    model?: string | null;
    modelReasoningEffort?: string | null;
    // Marks this queued item as a /compact request rather than a regular
    // prompt turn. Pushed via `messageQueue.pushIsolated(...)` so it never
    // batches with sibling prompts but still occupies its actual FIFO
    // position — the launcher's dequeue loop branches on this instead of
    // calling `backend.prompt()`, which keeps /compact from "cutting in
    // line" ahead of prompts that were already queued when it arrived.
    // `undefined` for normal prompts.
    operation?: 'compact' | 'clear';
    // Image attachments of this prompt, already read into base64 (see
    // readImageAttachments). The launcher appends them as ACP image content
    // blocks after the text block; `undefined` for prompts without images
    // (and for /compact and /clear operations).
    images?: OpencodePreparedImage[];
}

export type OpencodeHookEvent = {
    event: string;
    payload: unknown;
    sessionId?: string;
};
