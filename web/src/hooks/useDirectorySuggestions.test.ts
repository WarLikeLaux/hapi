import { describe, expect, it } from 'vitest'
import {
    getMatchingDirectoryPaths,
    resolveDirectorySearchTarget
} from './useDirectorySuggestions'

describe('directory filesystem suggestions', () => {
    it('lists the parent directory for a partially typed project name', () => {
        expect(resolveDirectorySearchTarget('/workspace/code/tele', ['/workspace/code'])).toEqual({
            directory: '/workspace/code',
            nameQuery: 'tele'
        })
    })

    it('lists a workspace root itself when the input is the root', () => {
        expect(resolveDirectorySearchTarget('/workspace/code', ['/workspace/code'])).toEqual({
            directory: '/workspace/code',
            nameQuery: ''
        })
    })

    it('does not browse a parent outside the configured workspace roots', () => {
        expect(resolveDirectorySearchTarget('/workspace/co', ['/workspace/code'])).toBeNull()
    })

    it('supports Windows workspace paths case-insensitively', () => {
        expect(resolveDirectorySearchTarget('C:\\Code\\Tele', ['c:\\code'])).toEqual({
            directory: 'C:\\Code',
            nameQuery: 'Tele'
        })
    })

    it('returns every matching child directory and excludes files', () => {
        const target = { directory: '/workspace/code', nameQuery: 'tele' }
        expect(getMatchingDirectoryPaths(target, [
            { name: 'myapp-web', type: 'directory' },
            { name: 'notes-myapp', type: 'directory' },
            { name: 'myapp-api', type: 'directory' },
            { name: 'myapp.txt', type: 'file' }
        ])).toEqual([
            '/workspace/code/myapp-api',
            '/workspace/code/myapp-web',
            '/workspace/code/notes-myapp'
        ])
    })
})
