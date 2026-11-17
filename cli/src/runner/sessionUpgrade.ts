import { readlink, realpath, stat } from 'node:fs/promises'
import type { SessionProcessIdentity } from '@hapi/protocol/schemas'
import { isBunCompiled } from '@/projectPath'
import { getProcessStartMarker } from '@/utils/process'
import { resolveHappyCliExecutable } from '@/utils/spawnHappyCLI'

/** Identify surviving processes of the same Linux installation after atomic binary replacement. */
export async function findStaleSessionProcesses(processes: readonly SessionProcessIdentity[]): Promise<number[]> {
    if (process.platform !== 'linux' || !isBunCompiled()) return []

    const installedPath = await realpath(resolveHappyCliExecutable()).catch(() => null)
    if (!installedPath) return []
    const [installed, runner] = await Promise.all([
        stat(installedPath, { bigint: true }).catch(() => null),
        stat('/proc/self/exe', { bigint: true }).catch(() => null),
    ])
    // A runner that has yet to upgrade must not replace any session processes.
    if (!installed || !runner || runner.dev !== installed.dev || runner.ino !== installed.ino) return []

    const stale: number[] = []
    for (const { pid, startMarker } of processes) {
        if (pid === process.pid) continue
        const executable = `/proc/${pid}/exe`
        const path = await readlink(executable).catch(() => null)
        if (path !== installedPath + ' (deleted)') continue
        if (getProcessStartMarker(pid) === startMarker) stale.push(pid)
    }
    return stale
}
