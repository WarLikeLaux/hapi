import { describe, expect, it } from 'vitest'
import { getPathDisplayName, getPathDisplayNames } from './path'

describe('getPathDisplayName', () => {
    it('keeps the final two segments for nested POSIX paths', () => {
        expect(getPathDisplayName('/home/user/coding/hapi')).toBe('coding/hapi')
    })

    it('supports Windows path separators', () => {
        expect(getPathDisplayName('C:\\Users\\Ananovo\\Downloads\\Agent\\Hapi')).toBe('Agent/Hapi')
    })

    it('keeps short paths and the fallback group unchanged', () => {
        expect(getPathDisplayName('hapi')).toBe('hapi')
        expect(getPathDisplayName('Other')).toBe('Other')
        expect(getPathDisplayName('')).toBe('')
    })
})

describe('getPathDisplayNames', () => {
    it('uses bare project names when they are unique', () => {
        expect(getPathDisplayNames(['/home/user/code/hapi', '/home/user/code/difit']))
            .toEqual(new Map([
                ['/home/user/code/hapi', 'hapi'],
                ['/home/user/code/difit', 'difit'],
            ]))
    })

    it('adds only enough parent directories to disambiguate collisions', () => {
        expect(getPathDisplayNames([
            '/home/user/code/hapi',
            '/home/user/work/hapi',
            '/srv/code/hapi',
        ])).toEqual(new Map([
            ['/home/user/code/hapi', 'user/code/hapi'],
            ['/home/user/work/hapi', 'work/hapi'],
            ['/srv/code/hapi', 'srv/code/hapi'],
        ]))
    })
})
