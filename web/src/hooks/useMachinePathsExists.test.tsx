import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useMachinePathsExists } from './useMachinePathsExists'

afterEach(cleanup)

it('does not repeatedly check unchanged paths when the caller rerenders', async () => {
    const checkMachinePathsExists = vi.fn(async () => ({ exists: { '/project': true } }))
    const api = { checkMachinePathsExists } as unknown as ApiClient
    const { result, rerender } = renderHook(() => useMachinePathsExists(api, 'machine', ['/project']))
    await waitFor(() => expect(result.current.pathExistence['/project']).toBe(true))
    rerender()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(checkMachinePathsExists).toHaveBeenCalledTimes(1)
})
