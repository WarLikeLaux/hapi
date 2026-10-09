import type { ChatBlock, NormalizedMessage, ToolCallBlock } from '@/chat/types'
import { getCodexCommandActions } from '@/chat/codexCommandPresentation'
import { getInputStringAny } from '@/lib/toolInputUtils'

export type AgentActivity = 'read' | 'search' | 'files' | 'edit' | 'test' | 'check' | 'build'
    | 'install' | 'git' | 'web' | 'browser' | 'image' | 'plan' | 'agents' | 'wait'
    | 'command' | 'tool' | 'multiple'

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const FILTERS = new Set(['head', 'tail', 'sort', 'uniq', 'wc', 'tee', 'cut', 'awk', 'jq'])
const basename = (value: string) => value.split(/[\\/]/).at(-1) ?? value

// Deliberately a small, conservative lexer, not a shell interpreter. Quoted
// arguments stay intact so a search pattern or script body cannot become an action.
function tokenize(command: string): Array<string | { separator: string }> | null {
    if (command.length > 20_000) return null
    const tokens: Array<string | { separator: string }> = []
    let token = ''
    let started = false
    let quote = ''
    for (let i = 0; i < command.length; i++) {
        const char = command[i]
        if (char === '\\' && quote !== "'") {
            if (i + 1 >= command.length) return null
            const next = command[++i]
            if (next !== '\n') {
                token += quote === '"' && !/[$`"\\]/.test(next) ? '\\' + next : next
                started = true
            }
            continue
        }
        if (quote) {
            if (char === quote) quote = ''
            else {
                if (quote === '"' && /[$`]/.test(char)) return null
                token += char
            }
            continue
        }
        if (char === '"' || char === "'") { quote = char; started = true; continue }
        if (/[<>$`(){}]/.test(char)) return null
        if (/\s/.test(char) || /[;&|]/.test(char)) {
            if (started) tokens.push(token)
            token = ''; started = false
            if (char === '\n' || /[;&|]/.test(char)) {
                const separator = char === '\n' ? ';' : char
                if ((char === '&' || char === '|') && command[i + 1] === char) {
                    tokens.push({ separator: char + command[++i] })
                } else tokens.push({ separator })
            }
            continue
        }
        if (char === '#' && !started) return null
        token += char; started = true
    }
    if (quote) return null
    if (started) tokens.push(token)
    return tokens
}

function scriptActivity(script: string | undefined): AgentActivity {
    if (!script) return 'command'
    if (/^(?:test|tests)(?:$|[:_-])/.test(script)) return 'test'
    if (/^(?:typecheck|lint|check|analyze)(?:$|[:_-])/.test(script)) return 'check'
    if (/^(?:build|compile)(?:$|[:_-])/.test(script)) return 'build'
    return 'command'
}

function argvActivity(argv: string[], depth: number): AgentActivity {
    if (depth > 4) return 'command'
    let index = 0
    while (ASSIGNMENT.test(argv[index] ?? '')) index++
    if (argv[index] === 'env') {
        index++
        while (['-i', '--ignore-environment'].includes(argv[index]) || ASSIGNMENT.test(argv[index] ?? '')) index++
    }
    if (argv[index] === 'sudo') {
        index++
        while (['-n', '-E', '--non-interactive', '--preserve-env'].includes(argv[index])) index++
    }
    const executable = basename(argv[index] ?? '')
    const args = argv.slice(index + 1)
    if (args.some(arg => ['--help', '--version', '--dry-run'].includes(arg))) return 'command'
    if (SHELLS.has(executable) && /^-[a-z]*c$/.test(args[0] ?? '') && args[1]) {
        return commandActivity(args[1], depth + 1)
    }
    if (['cat', 'head', 'tail', 'less', 'more', 'bat'].includes(executable)) return 'read'
    if (executable === 'sed') return args.some(arg => /^-\w*i/.test(arg) || arg.startsWith('--in-place')) ? 'edit' : 'read'
    if (['rg', 'grep', 'ag', 'ack'].includes(executable)) return args.includes('--files') ? 'files' : 'search'
    if (['find', 'fd'].includes(executable) && args.some(arg => ['-exec', '-execdir', '-delete', '-x', '--exec', '-X', '--exec-batch'].includes(arg))) return 'command'
    if (['ls', 'find', 'fd', 'tree', 'pwd'].includes(executable)) return 'files'
    if (executable === 'git') return 'git'
    if (['pytest', 'py.test', 'vitest', 'jest', 'phpunit', 'pest', 'ctest'].includes(executable)) return 'test'
    if (['tsc', 'eslint', 'ruff', 'mypy', 'pyright', 'phpstan', 'psalm'].includes(executable)) return 'check'
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable)) {
        let at = 0
        while (at < args.length && args[at].startsWith('-')) {
            if (['--cwd', '--prefix', '--dir', '-C', '--filter', '-F', '--workspace', '-w'].includes(args[at])) at += 2
            else return 'command'
        }
        const action = args[at]
        if (['install', 'ci', 'add', 'remove', 'update'].includes(action)) return 'install'
        if (action === 'run') {
            at++
            while (['--cwd', '--prefix', '--dir', '-C', '--filter', '-F', '--workspace', '-w'].includes(args[at])) at += 2
            return scriptActivity(args[at])
        }
        if (['exec', 'x', 'dlx'].includes(action)) return argvActivity(args.slice(at + 1), depth + 1)
        return scriptActivity(action)
    }
    if (['npx', 'uvx'].includes(executable)) return argvActivity(args, depth + 1)
    if (['python', 'python3'].includes(executable) && args[0] === '-m') return argvActivity(args.slice(1), depth + 1)
    if (executable === 'php' && ['phpunit', 'pest', 'phpstan', 'psalm'].includes(basename(args[0] ?? ''))) return argvActivity(args, depth + 1)
    if (executable === 'uv' && args[0] === 'run') return argvActivity(args.slice(1), depth + 1)
    if (['make', 'just', 'task'].includes(executable)) {
        let at = 0
        while (['-C', '-f', '--directory', '--makefile'].includes(args[at])) at += 2
        const targets = args.slice(at).filter(arg => !ASSIGNMENT.test(arg))
        if (!targets.length || targets.some(arg => arg.startsWith('-'))) return 'command'
        const activities = new Set(targets.map(scriptActivity))
        return activities.size === 1 ? scriptActivity(targets[0]) : 'command'
    }
    if (['cargo', 'go', 'dotnet', 'mvn', 'gradle', 'gradlew'].includes(executable)) {
        if (args[0] === 'test') return 'test'
        if (['check', 'clippy', 'vet'].includes(args[0])) return 'check'
        if (['build', 'package', 'compile'].includes(args[0])) return 'build'
    }
    if (executable === 'docker') {
        let at = args[0] === 'compose' ? 1 : 0
        while (['-f', '--file', '-p', '--project-name', '--project-directory'].includes(args[at])) at += 2
        if (args[at] === 'build') return 'build'
        if (args[at] === 'logs') return 'read'
        if (args[at] === 'exec') {
            at++
            while (['-T', '-i', '-t', '--interactive', '--tty'].includes(args[at])) at++
            // Container/service name precedes the actual executable.
            if (!args[at]?.startsWith('-')) return argvActivity(args.slice(at + 1), depth + 1)
        }
    }
    return 'command'
}

function commandActivity(command: string, depth = 0): AgentActivity {
    const tokens = tokenize(command)
    if (!tokens) return 'command'
    const activities: AgentActivity[] = []
    let argv: string[] = []
    let piped = false
    const flush = () => {
        if (argv.length && argv[0] !== 'cd' && !(piped && FILTERS.has(basename(argv[0])))) {
            activities.push(argvActivity(argv, depth))
        }
        argv = []
    }
    for (const token of tokens) {
        if (typeof token !== 'string') {
            if (token.separator === '||' || token.separator === '&') return 'command'
            flush(); piped = token.separator === '|'
        } else argv.push(token)
    }
    flush()
    const unique = new Set(activities)
    return unique.size === 1 ? activities[0] : 'command'
}

function toolActivity(block: ToolCallBlock): AgentActivity {
    const name = block.tool.name.replace(/^functions\./, '').toLowerCase()
    if (['bash', 'codexbash', 'exec_command', 'shell_command', 'run_shell_command', 'run command'].includes(name)) {
        const actions = getCodexCommandActions(block)
        if (actions.length && actions.every(action => action.type === actions[0].type)) {
            if (actions[0].type === 'read') return 'read'
            if (actions[0].type === 'search') return 'search'
            if (actions[0].type === 'listFiles') return 'files'
        }
        const command = getInputStringAny(block.tool.input, ['cmd', 'command'])
        if (command) return commandActivity(command)
        const input = block.tool.input as { command?: unknown } | null
        if (Array.isArray(input?.command) && input.command.every(part => typeof part === 'string')) return argvActivity(input.command, 0)
        return 'command'
    }
    if (['read', 'read_file', 'read_many_files', 'notebookread'].includes(name)) return 'read'
    if (['grep', 'search', 'search_file_content'].includes(name)) return 'search'
    if (['glob', 'ls', 'list_directory', 'list_files'].includes(name)) return 'files'
    if (['edit', 'multiedit', 'write', 'notebookedit', 'codexpatch', 'codexdiff', 'apply_patch', 'edit_file', 'write_file', 'replace'].includes(name)) return 'edit'
    if (['webfetch', 'websearch', 'web_search', 'search web', 'web search', 'web.run'].includes(name)) return 'web'
    if (['todowrite', 'update_plan', 'exitplanmode'].includes(name)) return 'plan'
    if (['task', 'agent', 'codexagent', 'spawn_agent', 'send_message', 'send_input', 'followup_task'].includes(name)) return 'agents'
    if (['wait', 'wait_agent', 'sleep', 'write_stdin'].includes(name)) return 'wait'
    if (name === 'imagegen' || name === 'image_gen.imagegen' || name.endsWith('__imagegen')) return 'image'
    if (name.startsWith('mcp__') && /__(?:browser_|navigate|screenshot)/.test(name)) return 'browser'
    // ACP kinds are structured semantics; native titles and arbitrary MCP names
    // can contain whole commands, prompts, URLs, or credentials. Never show them.
    const kind = block.tool.nativeKind?.toLowerCase()
    if (kind === 'read') return 'read'
    if (kind === 'edit') return 'edit'
    if (kind === 'search') return 'search'
    if (kind === 'execute') return 'command'
    if (kind === 'fetch') return 'web'
    return 'tool'
}

export function getAgentActivity(blocks: readonly ChatBlock[], messages: readonly NormalizedMessage[]): AgentActivity | null {
    // A missed tool result from a previous turn must not label a new turn.
    let boundary = 0
    for (const message of messages) {
        if (message.isSidechain) continue
        if ((message.role === 'user' && !message.steered)
            || (message.role === 'event' && message.content.type === 'ready' && !('agentId' in message.content && message.content.agentId))) {
            boundary = Math.max(boundary, message.createdAt)
        }
    }
    const running = blocks.filter((block): block is ToolCallBlock => block.kind === 'tool-call'
        && block.tool.state === 'running'
        && (block.tool.startedAt ?? block.createdAt) >= boundary)
    const activities = new Set(running.map(toolActivity))
    return activities.size > 1 ? 'multiple' : activities.values().next().value ?? null
}

export const AGENT_ACTIVITY_LABELS: Record<AgentActivity, string> = {
    read: 'Читает файлы…', search: 'Ищет в файлах…', files: 'Просматривает файлы…',
    edit: 'Редактирует файлы…', test: 'Запускает тесты…', check: 'Проверяет код…',
    build: 'Собирает проект…', install: 'Меняет зависимости…', git: 'Работает с Git…',
    web: 'Изучает веб…', browser: 'Работает в браузере…', image: 'Создаёт изображение…',
    plan: 'Обновляет план…', agents: 'Работает с агентами…', wait: 'Ожидает результат…',
    command: 'Выполняет команду…', tool: 'Использует инструмент…', multiple: 'Несколько действий…'
}
