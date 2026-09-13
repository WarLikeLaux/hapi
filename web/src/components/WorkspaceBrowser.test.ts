import { describe, expect, it } from 'vitest'
import type { MachineDirectoryEntry } from '@/types/api'
import { getSortedWorkspaceDirectories } from './WorkspaceBrowser'

function directory(name: string, modified: number): MachineDirectoryEntry {
    return { name, type: 'directory', modified }
}

describe('getSortedWorkspaceDirectories', () => {
    it('puts pinned projects first and otherwise sorts newest-first', () => {
        const entries: MachineDirectoryEntry[] = [
            directory('old', 10),
            directory('new', 30),
            directory('pinned', 20),
            { name: 'README.md', type: 'file', modified: 40 }
        ]

        const result = getSortedWorkspaceDirectories(
            entries,
            '/home/user/code',
            new Set(['/home/user/code/pinned']),
            ''
        )

        expect(result.map(entry => entry.name)).toEqual(['pinned', 'new', 'old'])
    })

    it('filters projects case-insensitively without changing pin priority', () => {
        const entries: MachineDirectoryEntry[] = [
            directory('HapiDocs', 10),
            directory('hapi', 30),
            directory('other', 40)
        ]

        const result = getSortedWorkspaceDirectories(
            entries,
            '/home/user/code',
            new Set(['/home/user/code/HapiDocs']),
            'HAPI'
        )

        expect(result.map(entry => entry.name)).toEqual(['HapiDocs', 'hapi'])
    })
})
