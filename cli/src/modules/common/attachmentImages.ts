import type { AttachmentMetadata } from '@/api/types';
import type { UploadFileIdentity } from './handlers/uploads';
import { readBoundedAttachmentFile } from './attachmentFile';
import { MAX_UPLOAD_BYTES } from './attachmentLimits';

/**
 * An image attachment read into memory, ready to be embedded into an
 * agent-facing prompt (Pi RPC image content, ACP `session/prompt` image
 * content block, ...).
 */
export interface PreparedImageContent {
    type: 'image';
    /** Base64-encoded image bytes. */
    data: string;
    mimeType: string;
}

export interface ReadImageAttachment {
    /** Source upload path of the attachment. */
    path: string;
    image: PreparedImageContent;
}

export interface ImageAttachmentPreparation {
    images: ReadImageAttachment[];
    /** One human-readable line per image that could not be read. */
    imageReadErrors: string[];
}

/**
 * Reads the image attachments of one user message into base64 content blocks.
 *
 * Non-image attachments are ignored here (flavors surface them as prompt text
 * references instead). Each failure is reported per-image via
 * `imageReadErrors` so the caller can forward it to the user while still
 * sending the images that did read. The caller is responsible for authorizing
 * the attachment path for its session (see readBoundedAttachmentFile for what
 * this helper validates itself).
 */
export async function readImageAttachments(
    attachments: AttachmentMetadata[] | undefined,
    options: {
        authorizeImagePath: (path: string) => boolean;
        authorizeOpenedImage: (path: string, identity: UploadFileIdentity) => boolean;
    },
): Promise<ImageAttachmentPreparation> {
    const images: ReadImageAttachment[] = [];
    const imageReadErrors: string[] = [];
    let totalImageBytes = 0;

    for (const attachment of attachments ?? []) {
        if (!attachment.mimeType.toLowerCase().startsWith('image/')) continue;
        try {
            const uploadPath = attachment.path;
            if (!options.authorizeImagePath(uploadPath)) {
                throw new Error('invalid upload path');
            }
            const data = await readBoundedAttachmentFile(
                uploadPath,
                MAX_UPLOAD_BYTES - totalImageBytes,
                (identity) => options.authorizeOpenedImage(uploadPath, identity),
            );
            totalImageBytes += data.length;
            images.push({
                path: uploadPath,
                image: { type: 'image', data: data.toString('base64'), mimeType: attachment.mimeType }
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            imageReadErrors.push(`Could not attach image ${attachment.filename}: ${detail}`);
        }
    }

    return { images, imageReadErrors };
}
