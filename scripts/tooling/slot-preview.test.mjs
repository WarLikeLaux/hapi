import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const webPackage = JSON.parse(readFileSync(join(sourceRoot, 'web/package.json'), 'utf8'))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

async function freePort() {
    const socket = createServer()
    socket.listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const port = socket.address().port
    await new Promise(resolve => socket.close(resolve))
    return port
}

async function waitFor(check, message) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await check()) return
        await delay(100)
    }
    assert.fail(message())
}

async function responds(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) })
        await response.text()
        return response.status === 200
    } catch {
        return false
    }
}

function fixture(t) {
    const base = mkdtempSync(join(tmpdir(), 'hapi-slot-preview-test-'))
    // Registered worktrees are created with real Git. Only Pitbox's documented
    // registry/ready files are fixture inputs; Vite and the launcher are real.
    const main = join(base, 'main')
    mkdirSync(join(main, 'web'), { recursive: true })
    mkdirSync(join(main, 'scripts/tooling'), { recursive: true })
    writeFileSync(join(main, '.gitignore'), 'node_modules\n')
    writeFileSync(join(main, 'web/package.json'), JSON.stringify({ type: 'module', scripts: { dev: webPackage.scripts.dev } }))
    writeFileSync(join(main, 'web/index.html'), '<h1>Real slot preview</h1>')
    writeFileSync(join(main, 'web/vite.config.mjs'), 'export default { optimizeDeps: { noDiscovery: true } }')
    copyFileSync(join(sourceRoot, 'scripts/tooling/slot-preview.mjs'), join(main, 'scripts/tooling/slot-preview.mjs'))
    run(main, 'git', 'init', '-b', 'main')
    run(main, 'git', 'config', 'user.name', 'Preview test')
    run(main, 'git', 'config', 'user.email', 'preview@example.invalid')
    run(main, 'git', 'add', '.')
    run(main, 'git', 'commit', '-m', 'Initial')
    const state = join(main, '.git/pitbox/slots')
    mkdirSync(state, { recursive: true })
    const children = []
    t.after(async () => {
        for (const child of children) {
            // Test-owned detached groups, including Bun's script shell.
            try { process.kill(-child.pid, 'SIGTERM') } catch {}
        }
        await Promise.all(children.map(async child => {
            if (child.exitCode !== null || child.signalCode !== null) return
            await Promise.race([once(child, 'exit'), delay(3_000)])
            try { process.kill(-child.pid, 'SIGKILL') } catch {}
        }))
        rmSync(base, { recursive: true, force: true })
    })
    const linkModules = path => symlinkSync(join(sourceRoot, 'web/node_modules'), join(path, 'web/node_modules'), 'dir')
    linkModules(main)
    return {
        main,
        slot(name) {
            const path = join(base, name)
            run(main, 'git', 'worktree', 'add', '-b', `task/${name}`, path)
            linkModules(path)
            writeFileSync(join(state, `${name}.path`), `${path}\n`)
            return path
        },
        ready(path, name, { branch = `task/${name}`, commit = run(path, 'git', 'rev-parse', 'HEAD') } = {}) {
            writeFileSync(join(state, `${name}.ready`), `branch: ${branch}\nslot: ${name}\ncommit: ${commit}\nupdated: ${Date.now()}\nnotes: test\n`)
        },
        async start(path, { invocation = 'script', port: requestedPort, expectStart = true } = {}) {
            const port = requestedPort ?? await freePort()
            const command = invocation === 'vite'
                ? [process.execPath, join(sourceRoot, 'web/node_modules/vite/bin/vite.js')]
                : invocation === 'launcher'
                    ? [process.execPath, join(path, 'scripts/tooling/slot-preview.mjs')]
                    : ['bun', 'run', 'dev', '--']
            const child = spawn(command[0], [...command.slice(1), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
                cwd: join(path, 'web'), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
            })
            children.push(child)
            let output = ''
            child.stdout.on('data', data => { output += data })
            child.stderr.on('data', data => { output += data })
            if (expectStart) {
                await waitFor(() => responds(port), () => `Preview did not start: ${output}`)
            } else {
                await waitFor(() => child.exitCode !== null, () => `Failed startup left launcher running: ${output}`)
            }
            return { child, port, output: () => output }
        },
    }
}

test('ready frees its owned preview port, preserves active and foreign previews, and permits review after ready', { timeout: 45_000 }, async t => {
    const f = fixture(t)
    const a = f.slot('wt1')
    const b = f.slot('wt2')
    const own = await f.start(a)
    const active = await f.start(b)
    const foreign = await f.start(a, { invocation: 'vite' })
    const main = await f.start(f.main)

    // Idle time, same-branch commits and stale readiness do not end a task.
    writeFileSync(join(a, 'task.txt'), 'Task work')
    run(a, 'git', 'add', 'task.txt')
    run(a, 'git', 'commit', '-m', 'Task work')
    f.ready(a, 'wt1', { branch: 'task/previous' })
    await delay(1_200)
    assert.equal(await responds(own.port), true)
    f.ready(a, 'wt1', { commit: run(a, 'git', 'rev-parse', 'HEAD~') })
    await delay(1_200)
    assert.equal(await responds(own.port), true)

    f.ready(a, 'wt1')
    await waitFor(() => own.child.exitCode !== null, () => `Ready left Vite running: ${own.output()}`)
    assert.equal(own.child.exitCode, 0)
    assert.equal(await responds(own.port), false)
    const rebound = createServer()
    rebound.listen(own.port, '127.0.0.1')
    await once(rebound, 'listening')
    await new Promise(resolve => rebound.close(resolve))
    for (const preview of [active, foreign, main]) assert.equal(await responds(preview.port), true)

    // A deliberate post-ready review remains live until slot reset/release.
    const review = await f.start(a)
    await delay(1_200)
    assert.equal(await responds(review.port), true)
    run(a, 'git', 'checkout', '-B', 'slot/wt1', 'main')
    await waitFor(() => review.child.exitCode !== null, () => `Reset left review running: ${review.output()}`)
    assert.equal(await responds(review.port), false)
    for (const preview of [active, foreign, main]) assert.equal(await responds(preview.port), true)

    // Losing the launching command must not remove lifecycle supervision.
    active.child.kill('SIGKILL')
    await once(active.child, 'exit')
    assert.equal(await responds(active.port), true)
    f.ready(b, 'wt2')
    await waitFor(async () => !await responds(active.port), () => `Orphaned launch left Vite running: ${active.output()}`)
    for (const preview of [foreign, main]) assert.equal(await responds(preview.port), true)
})

test('normal stop and startup failure leave no managed Vite running', { timeout: 25_000 }, async t => {
    const f = fixture(t)
    const slot = f.slot('wt1')
    const preview = await f.start(slot, { invocation: 'launcher' })
    // Signal the launcher itself, rather than the entire test process group.
    preview.child.kill('SIGTERM')
    await waitFor(() => preview.child.signalCode !== null || preview.child.exitCode !== null, () => `Stop left launcher running: ${preview.output()}`)
    assert.equal(await responds(preview.port), false)

    const occupied = await f.start(slot, { invocation: 'vite' })
    const failed = await f.start(slot, { port: occupied.port, expectStart: false })
    assert.notEqual(failed.child.exitCode, 0)
    assert.match(failed.output(), /already in use/)
    assert.equal(await responds(occupied.port), true)
})
