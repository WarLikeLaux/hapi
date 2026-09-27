import type { Machine } from '@/types/api'
import type { AgentType } from './types'

// Display order for the Create Session agent picker: Codex, MiniMax Code,
// GLM (the claude flavor is branded as GLM in this fork), Antigravity,
// Cursor, OpenCode. Any agent not listed here keeps its incoming order and
// renders after the curated ones so a newly-added flavor still appears.
const CREATE_SESSION_AGENT_ORDER: readonly AgentType[] = [
    'codex',
    'minimax',
    'claude',
    'agy',
    'cursor',
    'opencode',
]

export function orderCreateSessionAgents(agents: readonly AgentType[]): AgentType[] {
    return [...agents].sort((left, right) => {
        const leftIndex = CREATE_SESSION_AGENT_ORDER.indexOf(left)
        const rightIndex = CREATE_SESSION_AGENT_ORDER.indexOf(right)
        if (leftIndex === -1 && rightIndex === -1) return 0
        if (leftIndex === -1) return 1
        if (rightIndex === -1) return -1
        return leftIndex - rightIndex
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
