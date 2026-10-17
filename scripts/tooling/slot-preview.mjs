import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { constants } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const webRoot = process.cwd()
const git = (...args) => execFileSync('git', ['-C', webRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim()

function readOptional(path) {
    try {
        return readFileSync(path, 'utf8')
    } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
    }
}

function findSlot() {
    let root, common, headPath
    try {
        [root, common, headPath] = git('rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-path', 'HEAD').split('\n')
    } catch {
        return undefined
    }
    const slots = join(common, 'pitbox/slots')
    let entries
    try {
        entries = readdirSync(slots)
    } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
    }
    for (const entry of entries.filter(name => name.endsWith('.path'))) {
        const registry = join(slots, entry)
        const registeredPath = readOptional(registry)?.trim()
        if (!registeredPath || resolve(registeredPath) !== realpathSync(root)) continue
        const name = entry.slice(0, -'.path'.length)
        return {
            name, registry, registeredPath,
            headPath, head: readFileSync(headPath, 'utf8'),
            readyPath: join(slots, `${name}.ready`),
        }
    }
    return undefined
}

const slot = findSlot()
let previousReady = slot && readOptional(slot.readyPath)
const require = createRequire(join(webRoot, 'package.json'))
const viteCli = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const child = spawn(process.execPath, [viteCli, ...args], { cwd: webRoot, stdio: 'inherit' })
let stopping = false
let lifecycleStop = false
let escalation
let watcher

function stop(signal = 'SIGTERM') {
    if (stopping || child.exitCode !== null || child.signalCode !== null) return
    stopping = true
    child.kill(signal)
    // Only this launcher-owned child is signalled. No PID files, port scans,
    // process-name matching, or process groups shared with other tasks.
    escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 5_000)
    escalation.unref()
}

if (slot) {
    console.log(`[slot-preview] ${slot.name}: stops on the next ready or slot reset`)
    watcher = setInterval(() => {
        if (stopping) return
        try {
            let reason
            if (readOptional(slot.registry)?.trim() !== slot.registeredPath || readOptional(slot.headPath) !== slot.head) {
                reason = 'slot reset or removed'
            } else {
                const ready = readOptional(slot.readyPath)
                if (ready !== previousReady) {
                    const branch = slot.head.match(/^ref: refs\/heads\/(.+)\n?$/)?.[1]
                    if (
                        ready && branch
                        && ready.match(/^branch: (.+)$/m)?.[1] === branch
                        && ready.match(/^slot: (.+)$/m)?.[1] === slot.name
                        && ready.match(/^commit: (.+)$/m)?.[1] === git('rev-parse', 'HEAD')
                    ) {
                        reason = 'task marked ready'
                    }
                    previousReady = ready
                }
            }
            if (reason) {
                console.log(`[slot-preview] ${reason}; stopping this preview`)
                lifecycleStop = true
                stop()
            }
        } catch (error) {
            // A read failure is not proof that the task ended. Keep serving.
            console.error(`[slot-preview] cannot read slot state: ${error.message}`)
        }
    }, 1_000)
}

const onTerm = () => stop('SIGTERM')
const onInt = () => stop('SIGINT')
const onHup = () => stop('SIGHUP')
process.on('SIGTERM', onTerm)
process.on('SIGINT', onInt)
process.on('SIGHUP', onHup)
child.once('error', error => console.error(`[slot-preview] ${error.message}`))
child.once('close', (code, signal) => {
    clearInterval(watcher)
    clearTimeout(escalation)
    process.off('SIGTERM', onTerm)
    process.off('SIGINT', onInt)
    process.off('SIGHUP', onHup)
    process.exitCode = lifecycleStop ? 0 : code ?? (signal ? 128 + constants.signals[signal] : 1)
})
