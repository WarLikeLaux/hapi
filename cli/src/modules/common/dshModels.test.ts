import { homedir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
    spawnCwd: undefined as string | undefined,
    sessionCwd: undefined as string | undefined,
    disconnect: vi.fn(async () => {}),
}))

vi.mock('@/agent/backends/acp/AcpSdkBackend', () => ({
    AcpSdkBackend: class {
        constructor(options: { spawnCwd?: string }) { harness.spawnCwd = options.spawnCwd }
        async initialize() {}
        async newSession(options: { cwd: string }) { harness.sessionCwd = options.cwd; return 'catalog-probe' }
        getSessionModelsMetadata() {
            return { availableModels: [{ modelId: '["provider","model"]', name: 'DSH model' }], currentModelId: '["provider","model"]' }
        }
        disconnect = harness.disconnect
    },
}))

describe('machine-level DSH model discovery', () => {
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

    it('starts both the process and throwaway session in the home directory', async () => {
        vi.useFakeTimers()
        const { listDshModelsForMachine } = await import('./dshModels')
        const response = await listDshModelsForMachine()
        expect(response.success).toBe(true)
        expect(harness.spawnCwd).toBe(homedir())
        expect(harness.sessionCwd).toBe(homedir())
        expect(harness.disconnect).toHaveBeenCalledOnce()
    })
})
