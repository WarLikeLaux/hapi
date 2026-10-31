import type { Machine } from '@/types/api'
import { basename } from '@/utils/path'
import type { AgentType } from './types'

// Display order for the Create Session agent picker: Codex, GLM (the claude
// flavor is branded as GLM in this fork), Antigravity, OpenCode, Cursor.
// Other agents keep their incoming order after these; MiniMax Code goes last.
const CREATE_SESSION_AGENT_ORDER: readonly AgentType[] = [
    'codex',
    'claude',
    'agy',
    'opencode',
    'cursor',
]

export function orderCreateSessionAgents(agents: readonly AgentType[]): AgentType[] {
    return [...agents].sort((left, right) => {
        if (left === 'minimax' || right === 'minimax') {
            if (left === right) return 0
            return left === 'minimax' ? 1 : -1
        }
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
    recentPaths: readonly string[],
    hiddenPaths: readonly string[] = []
): string {
    const visiblePaths = recentPaths.filter(path => !hiddenPaths.includes(path.trim()))
    const hapiPath = visiblePaths
        .map((path) => path.trim())
        .find((path) => path.length > 0 && basename(path) === 'hapi')
    if (hapiPath) return hapiPath

    const workspaceRoot = machine.metadata?.workspaceRoots
        ?.find((path) => path.trim().length > 0 && !hiddenPaths.includes(path.trim()))
        ?.trim()
    if (workspaceRoot) return workspaceRoot

    const recentPath = visiblePaths.find((path) => path.trim().length > 0)?.trim()
    if (recentPath) return recentPath

    const home = machine.metadata?.homeDir?.trim() ?? ''
    return hiddenPaths.includes(home) ? '' : home
}
