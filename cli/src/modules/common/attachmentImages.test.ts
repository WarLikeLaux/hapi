import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { readImageAttachments } from './attachmentImages';

describe('readImageAttachments', () => {
    it('reads image attachments into base64 content blocks, keeping each source path', async () => {
        const imagePath = join(process.env.TMPDIR ?? '/tmp', `attach-image-${Date.now()}.png`);
        await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        try {
            const prepared = await readImageAttachments([
                { id: 'image', filename: 'plot.png', mimeType: 'image/png', size: 4, path: imagePath },
                { id: 'text', filename: 'notes.txt', mimeType: 'text/plain', size: 1, path: '/tmp/notes.txt' },
            ], {
                authorizeImagePath: () => true,
                authorizeOpenedImage: () => true,
            });
            expect(prepared.images).toEqual([
                { path: imagePath, image: { type: 'image', mimeType: 'image/png', data: 'iVBORw==' } },
            ]);
            expect(prepared.imageReadErrors).toEqual([]);
        } finally {
            await rm(imagePath, { force: true });
        }
    });

    it('reports a per-image error for a missing file without losing earlier images', async () => {
        const prepared = await readImageAttachments([
            { id: 'missing', filename: 'missing.png', mimeType: 'image/png', size: 1, path: '/missing/image.png' },
        ], {
            authorizeImagePath: () => true,
            authorizeOpenedImage: () => true,
        });
        expect(prepared.images).toEqual([]);
        expect(prepared.imageReadErrors).toEqual(['Could not attach image missing.png: ENOENT: no such file or directory, open \'/missing/image.png\'']);
    });

    it('rejects paths the caller did not authorize', async () => {
        const prepared = await readImageAttachments([
            { id: 'forged', filename: 'hosts.png', mimeType: 'image/png', size: 1, path: '/etc/hosts' },
        ], {
            authorizeImagePath: () => false,
            authorizeOpenedImage: () => false,
        });
        expect(prepared.images).toEqual([]);
        expect(prepared.imageReadErrors).toEqual(['Could not attach image hosts.png: invalid upload path']);
    });

    it('rejects a symlink the opened-file identity check did not authorize', async () => {
        const uploadDir = await mkdtemp(join(tmpdir(), 'attach-image-auth-'));
        const outsidePath = process.platform === 'win32' ? null : join(tmpdir(), `attach-image-outside-${Date.now()}.png`);
        const symlinkPath = process.platform === 'win32' ? null : join(uploadDir, 'escape.png');
        if (outsidePath && symlinkPath) {
            await writeFile(outsidePath, Buffer.from([1, 2, 3, 4]));
            await symlink(outsidePath, symlinkPath);
        }
        try {
            if (!symlinkPath) {
                return;
            }
            const prepared = await readImageAttachments([
                { id: 'symlink', filename: 'escape.png', mimeType: 'image/png', size: 4, path: symlinkPath },
            ], {
                authorizeImagePath: (path) => path.startsWith(`${uploadDir}${sep}`),
                authorizeOpenedImage: () => false,
            });
            expect(prepared.images).toEqual([]);
            expect(prepared.imageReadErrors[0]).toContain('Could not attach image escape.png');
        } finally {
            if (outsidePath) await rm(outsidePath, { force: true });
            await rm(uploadDir, { recursive: true, force: true });
        }
    });
});
