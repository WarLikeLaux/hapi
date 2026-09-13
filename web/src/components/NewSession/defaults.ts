import type { Machine } from '@/types/api'
import type { AgentType } from './types'

export function putCodexFirst(agents: readonly AgentType[]): AgentType[] {
    return [...agents].sort((left, right) => {
        if (left === 'codex') return -1
        if (right === 'codex') return 1
        return 0
    })
}

export function resolveDefaultMachineDirectory(
    machine: Machine,
    recentPaths: readonly string[]
): string {
    const workspaceRoot = machine.metadata?.workspaceRoots
        ?.find((path) => path.trim().length > 0)
        ?.trim()
    if (workspaceRoot) return workspaceRoot

    const recentPath = recentPaths.find((path) => path.trim().length > 0)?.trim()
    if (recentPath) return recentPath

    return machine.metadata?.homeDir?.trim() ?? ''
}
