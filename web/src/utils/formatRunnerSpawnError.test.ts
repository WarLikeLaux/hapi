import { describe, expect, it } from 'vitest'
import type { Machine } from '../types/api'
import { formatRunnerSpawnError } from './formatRunnerSpawnError'

function machineWithSpawnError(message: string, at?: number): Machine {
    return {
        runnerState: {
            lastSpawnError: at === undefined ? { message } : { message, at }
        }
    } as Machine
}

describe('formatRunnerSpawnError', () => {
    it('shows a recent runner spawn error', () => {
        expect(formatRunnerSpawnError(machineWithSpawnError('spawn failed', 9_500), 10_000))
            .toContain('spawn failed')
    })

    it('hides a stale runner spawn error', () => {
        expect(formatRunnerSpawnError(machineWithSpawnError('old failure', 1_000), 62_000))
            .toBeNull()
    })

    it('keeps errors without a timestamp visible', () => {
        expect(formatRunnerSpawnError(machineWithSpawnError('unknown time'), 10_000))
            .toBe('unknown time')
    })
})
