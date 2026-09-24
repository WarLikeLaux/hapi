import { describe, expect, it } from 'vitest'
import {
    getMatchingDirectoryPaths,
    resolveDirectorySearchTarget
} from './useDirectorySuggestions'

describe('directory filesystem suggestions', () => {
    it('lists the parent directory for a partially typed project name', () => {
        expect(resolveDirectorySearchTarget('/workspace/code/proj', ['/workspace/code'])).toEqual({
            directory: '/workspace/code',
            nameQuery: 'proj'
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
        expect(resolveDirectorySearchTarget('C:\\Code\\Proj', ['c:\\code'])).toEqual({
            directory: 'C:\\Code',
            nameQuery: 'Proj'
        })
    })

    it('returns every matching child directory and excludes files', () => {
        const target = { directory: '/workspace/code', nameQuery: 'proj' }
        expect(getMatchingDirectoryPaths(target, [
            { name: 'project-web', type: 'directory' },
            { name: 'notes-project', type: 'directory' },
            { name: 'project-api', type: 'directory' },
            { name: 'project.txt', type: 'file' }
        ])).toEqual([
            '/workspace/code/project-api',
            '/workspace/code/project-web',
            '/workspace/code/notes-project'
        ])
    })
})
