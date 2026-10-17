import { getAgyModelLabel, getClaudeModelLabel } from '@hapi/protocol'
import { formatCodexReasoningEffortLabel } from '@/components/AssistantChat/codexReasoningEffortOptions'
import {
    CODEX_HARDCODED_OPTIONS,
    OPENCODE_HARDCODED_LABEL,
    OPENCODE_HARDCODED_MODEL_ID,
} from '@/components/NewSession/hardcodedModels'

const EFFORT_SUFFIXES = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

const KNOWN_MODEL_NAMES: Record<string, string> = {
    [OPENCODE_HARDCODED_MODEL_ID]: OPENCODE_HARDCODED_LABEL,
}
for (const option of CODEX_HARDCODED_OPTIONS) {
    KNOWN_MODEL_NAMES[option.value] = option.label
}

type ParsedModel = {
    name: string
    effort: string | null
    fast: boolean
}

function basename(id: string): string {
    const slash = id.lastIndexOf('/')
    return slash === -1 ? id : id.slice(slash + 1)
}

function capitalizeToken(part: string): string {
    if (/^\d/.test(part)) return part
    const lower = part.toLowerCase()
    if (lower === 'gpt' || lower === 'glm') return lower.toUpperCase()
    return part.charAt(0).toUpperCase() + part.slice(1)
}

function parseSlug(id: string): ParsedModel {
    const known = KNOWN_MODEL_NAMES[id] ?? KNOWN_MODEL_NAMES[basename(id)]
    if (known) return { name: known, effort: null, fast: false }
    const preset = getAgyModelLabel(id) ?? getClaudeModelLabel(id)
    if (preset) return { name: preset, effort: null, fast: false }
    if (/[A-Z ]/.test(id)) return { name: id, effort: null, fast: false }

    let slug = basename(id)
    let effort: string | null = null
    let fast = false
    const bracket = slug.indexOf('[')
    if (bracket !== -1) {
        const params = slug.slice(bracket + 1)
        effort = params.match(/effort=([a-z0-9]+)/i)?.[1] ?? null
        fast = /fast=true/i.test(params)
        slug = slug.slice(0, bracket)
    }
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(slug)) {
        return { name: id, effort, fast }
    }
    const parts = slug.split('-')
    if (parts[parts.length - 1] === 'fast') {
        fast = true
        parts.pop()
    }
    const tail = parts[parts.length - 1]
    if (tail && EFFORT_SUFFIXES.has(tail)) {
        effort = effort ?? tail
        parts.pop()
    }
    return {
        name: parts.map(capitalizeToken).join(' '),
        effort,
        fast,
    }
}

function effortWord(
    flavor: string | null | undefined,
    modelReasoningEffort: string | null | undefined,
    effort: string | null | undefined,
    effortLabel: string | null | undefined,
    parsedEffort: string | null
): string | null {
    const explicit = effortLabel?.trim()
    if (explicit && explicit.toLowerCase() !== 'default') {
        return /[A-Z ]/.test(explicit) ? explicit : formatCodexReasoningEffortLabel(explicit)
    }
    const reasoning = modelReasoningEffort?.trim() ?? ''
    const level = effort?.trim() ?? ''
    let raw = ''
    if (flavor === 'opencode') raw = reasoning && reasoning.toLowerCase() !== 'default' ? reasoning : 'max'
    else if (flavor === 'codex') raw = reasoning.toLowerCase() === 'default' ? '' : reasoning
    else if (flavor === 'pi' || flavor === 'grok' || flavor === 'claude') raw = level.toLowerCase() === 'default' ? '' : level
    else raw = parsedEffort ?? ''
    if (!raw || raw.toLowerCase() === 'default') return null
    return formatCodexReasoningEffortLabel(raw)
}

/** Icon sits beside this string: "Grok 4.7 Fast (XHigh)". */
export function modelChipText(args: {
    name: string
    wireId?: string | null
    flavor?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    effortLabel?: string | null
    fast?: boolean
}): string {
    const given = args.name.trim()
    const wireId = args.wireId?.trim() || given
    const parsed = parseSlug(wireId)
    const knownName = KNOWN_MODEL_NAMES[wireId] ?? KNOWN_MODEL_NAMES[basename(wireId)]
    let name = knownName ?? (given && /[A-Z ]/.test(given) ? given : parsed.name)
    const effort = effortWord(args.flavor, args.modelReasoningEffort, args.effort, args.effortLabel, parsed.effort)
    if ((args.fast || parsed.fast) && !/\bfast\b/i.test(name)) name += ' Fast'
    return effort ? `${name} (${effort})` : name
}

export function prettyModelName(label: string): string {
    return parseSlug(label).name
}
