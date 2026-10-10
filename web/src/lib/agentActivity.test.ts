import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from '@/chat/types'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { getAgentActivity } from './agentActivity'

function tool(id: string, name: string, input: unknown, createdAt = 100): NormalizedMessage {
    const message = normalizeDecryptedMessage({
        id, seq: createdAt, localId: null, createdAt,
        content: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: id, name, input } } }
    })
    if (!message) throw new Error('Invalid tool message')
    return message
}

function activity(messages: NormalizedMessage[]) {
    return getAgentActivity(reduceChatBlocks(messages, null).blocks, messages)
}

describe('live agent activity', () => {
    it.each([
        ['Read', { file_path: '/project/tests/read.test.ts' }, 'read'],
        ['Edit', { file_path: '/project/src/app.ts' }, 'edit'],
        ['CodexPatch', { changes: {} }, 'edit'],
        ['Grep', { pattern: 'npm test' }, 'search'],
        ['Glob', { pattern: '**/*.py' }, 'files'],
        ['WebFetch', { url: 'https://example.com' }, 'web'],
        ['Task', { prompt: 'Inspect tests' }, 'agents'],
        ['mcp__custom__execute', { command: 'pytest', token: 'secret' }, 'tool'],
        ['CodexBash', { command: ['/bin/bash', '-lc', 'cd /repo && python -m pytest -q'] }, 'test'],
        ['CodexBash', { command: 'unrecognized wrapper', command_actions: [{ type: 'read', command: 'cat x', name: 'x', path: '/x' }] }, 'read'],
        ['Bash', { command: 'rg "npm test" src | head -20' }, 'search'],
        ['Bash', { command: 'rg "|" src' }, 'search'],
        ['Bash', { command: 'rg --files /project' }, 'files'],
        ['Bash', { command: 'sed -n \'10,20p\' app.py' }, 'read'],
        ['Bash', { command: 'sed -i \'s/old/new/\' app.py' }, 'edit'],
        ['Bash', { command: '/bin/bash -lc "bun run test:web"' }, 'test'],
        ['Bash', { command: 'CI=1 env NODE_ENV=test npm test' }, 'test'],
        ['Bash', { command: 'pnpm --filter backend test' }, 'test'],
        ['Bash', { command: 'bun --cwd web run typecheck' }, 'check'],
        ['Bash', { command: 'bun run --cwd web test' }, 'test'],
        ['Bash', { command: 'make test build' }, 'command'],
        ['Bash', { command: 'find . -exec pytest {} ;' }, 'command'],
        ['Bash', { command: 'npx vitest run' }, 'test'],
        ['Bash', { command: 'uv run pytest -q' }, 'test'],
        ['Bash', { command: 'cargo test --workspace' }, 'test'],
        ['Bash', { command: 'go test ./...' }, 'test'],
        ['Bash', { command: 'dotnet test' }, 'test'],
        ['Bash', { command: './gradlew test' }, 'test'],
        ['Bash', { command: 'mvn test' }, 'test'],
        ['Bash', { command: 'make -C backend test-full' }, 'test'],
        ['Bash', { command: 'docker compose -f compose.yml exec -T php php vendor/bin/phpunit' }, 'test'],
        ['Bash', { command: 'docker exec app sh -c "pytest"' }, 'test'],
        ['Bash', { command: 'cargo clippy' }, 'check'],
        ['Bash', { command: 'npm run build' }, 'build'],
        ['Bash', { command: 'docker compose build' }, 'build'],
        ['Bash', { command: 'npm ci' }, 'install'],
        ['Bash', { command: 'git -C /repo diff' }, 'git'],
        ['Bash', { command: 'npm run custom-script' }, 'command'],
        ['Bash', { command: 'npm run cat' }, 'command'],
        ['Bash', { command: 'cat tests/test.py && pytest' }, 'command'],
        ['Bash', { command: 'npm test && npm run build' }, 'command'],
        ['Bash', { command: 'python -c "print(\'pytest\')"' }, 'command'],
        ['Bash', { command: "python - <<'PY'\nprint('npm test')\nPY" }, 'command'],
        ['Bash', { command: 'echo "npm test"' }, 'command'],
        ['Bash', { command: 'npm test || npm run build' }, 'command'],
        ['Bash', { command: 'npm test & npm run build' }, 'command'],
        ['Bash', { command: 'pytest --help' }, 'command'],
        ['Bash', { command: '$(which pytest)' }, 'command'],
        ['Bash', { command: 'npm test "unfinished' }, 'command']
    ])('identifies %s %j without using project paths or argument keywords', (name, input, expected) => {
        expect(activity([tool('call', name, input)])).toBe(expected)
    })

    it('retires the action on a tool result instead of keeping the last command', () => {
        const messages = [tool('call', 'Bash', { command: 'pytest' })]
        expect(activity(messages)).toBe('test')
        const result = normalizeDecryptedMessage({
            id: 'result', seq: 101, localId: null, createdAt: 101,
            content: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'call', output: 'passed' } } }
        })!
        expect(activity([...messages, result])).toBeNull()
    })

    it('does not revive a missing result from a previous turn', () => {
        const old = tool('old', 'Bash', { command: 'pytest' })
        const ready: NormalizedMessage = { id: 'ready', localId: null, createdAt: 110, role: 'event', isSidechain: false, content: { type: 'ready' }, meta: null }
        expect(activity([old, ready])).toBeNull()
        expect(activity([old, ready, tool('new', 'Read', {}, 120)])).toBe('read')
    })

    it('keeps an ongoing action across steering but excludes old actions after a new user turn', () => {
        const running = tool('call', 'Bash', { command: 'pytest' })
        const user: NormalizedMessage = { id: 'user', localId: null, createdAt: 110, role: 'user', isSidechain: false, content: { type: 'text', text: 'Also check mobile' } }
        expect(activity([running, { ...user, steered: true }])).toBe('test')
        expect(activity([running, user])).toBeNull()
    })

    it('reports simultaneous work without guessing a phase', () => {
        expect(activity([tool('test', 'Bash', { command: 'pytest' }), tool('read', 'Read', {})])).toBe('multiple')
        expect(activity([tool('read-1', 'Read', {}), tool('read-2', 'Read', {})])).toBe('read')
    })

    it('uses the parent action while a delegated child is reading files', () => {
        const messages = [tool('agent', 'Task', {})]
        const blocks = reduceChatBlocks(messages, null).blocks
        const parent = blocks[0]
        if (parent.kind !== 'tool-call') throw new Error('Missing Task')
        parent.children = reduceChatBlocks([tool('child', 'Read', {})], null).blocks
        expect(getAgentActivity(blocks, messages)).toBe('agents')
    })
})
