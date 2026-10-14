import { describe, expect, it } from 'vitest'
import { buildExternalEditorFileUrl, resolveExternalEditorFolder } from './external-editor-url'

describe('buildExternalEditorFileUrl', () => {
    it('builds a folder + openFile payload URL', () => {
        const url = buildExternalEditorFileUrl(
            'https://code.local',
            'code.local',
            '/home/shandori/code/proj',
            { file: '/home/shandori/code/proj/models/A.php' }
        )
        const parsed = new URL(url)
        expect(parsed.origin).toBe('https://code.local')
        expect(parsed.searchParams.get('folder')).toBe('/home/shandori/code/proj')
        expect(JSON.parse(parsed.searchParams.get('payload')!)).toEqual([
            ['openFile', 'vscode-remote://code.local/home/shandori/code/proj/models/A.php'],
        ])
    })

    it('adds gotoLineMode with line and column', () => {
        const url = buildExternalEditorFileUrl(
            'https://code.local',
            'code.local',
            '/home/shandori/code/proj',
            { file: '/home/shandori/code/proj/models/A.php', line: 675, column: 4 }
        )
        const payload = JSON.parse(new URL(url).searchParams.get('payload')!)
        expect(payload).toEqual([
            ['gotoLineMode', 'true'],
            ['openFile', 'vscode-remote://code.local/home/shandori/code/proj/models/A.php:675:4'],
        ])
    })
})

describe('resolveExternalEditorFolder', () => {
    it('prefers the workspace root containing the file', () => {
        expect(resolveExternalEditorFolder('/home/shandori/code/proj/', '/home/shandori/code/proj/a/b.php'))
            .toBe('/home/shandori/code/proj')
    })

    it('falls back to the file parent directory', () => {
        expect(resolveExternalEditorFolder(null, '/home/shandori/code/other/x.php'))
            .toBe('/home/shandori/code/other')
        expect(resolveExternalEditorFolder('/home/shandori/code/proj', '/home/shandori/code/other/x.php'))
            .toBe('/home/shandori/code/other')
    })
})
