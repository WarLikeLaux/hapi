export type CodexComposerReasoningEffortOption = {
    value: string | null
    label: string
}

export type ComposerReasoningEffortSourceOption = {
    value: string
    name?: string
}

const CODEX_REASONING_EFFORT_PRESETS = ['low', 'medium', 'high', 'xhigh'] as const
const CODEX_REASONING_EFFORT_LABELS: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max',
    ultra: 'Ultra'
}

function normalizeCodexComposerReasoningEffort(effort?: string | null): string | null {
    const trimmedEffort = effort?.trim().toLowerCase()
    if (!trimmedEffort || trimmedEffort === 'default') {
        return null
    }

    return trimmedEffort
}

export function formatCodexReasoningEffortLabel(effort: string): string {
    return CODEX_REASONING_EFFORT_LABELS[effort as keyof typeof CODEX_REASONING_EFFORT_LABELS]
        ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

/**
 * Builds the option list with the no-pick row named after `defaultEffort` —
 * the effort the provider's own config uses when nothing is set (same honesty
 * as the create form's no-pick naming). The explicit row for that same effort
 * is skipped unless the user pinned it, so "High" never appears twice.
 */
function buildReasoningEffortOptions(
    currentEffort: string | null,
    rows: Array<{ value: string; label: string }>,
    defaultEffort: string | null
): CodexComposerReasoningEffortOption[] {
    const optionValues = new Set(rows.map((row) => row.value))
    const options: CodexComposerReasoningEffortOption[] = [
        { value: null, label: defaultEffort ? formatCodexReasoningEffortLabel(defaultEffort) : 'Default' }
    ]

    if (currentEffort && !optionValues.has(currentEffort)) {
        options.push({
            value: currentEffort,
            label: formatCodexReasoningEffortLabel(currentEffort)
        })
    }

    options.push(...rows.filter((row) => row.value !== defaultEffort || currentEffort === row.value))

    return options
}

function buildDynamicReasoningEffortOptions(
    currentEffort: string | null,
    dynamicOptions: ComposerReasoningEffortSourceOption[],
    defaultEffort: string | null = null
): CodexComposerReasoningEffortOption[] {
    return buildReasoningEffortOptions(
        currentEffort,
        dynamicOptions.map((option) => ({
            value: option.value,
            label: option.name ?? formatCodexReasoningEffortLabel(option.value)
        })),
        defaultEffort
    )
}

export function getCodexComposerReasoningEffortOptions(
    currentEffort?: string | null,
    flavor?: string | null,
    dynamicOptions?: ComposerReasoningEffortSourceOption[] | null,
    defaultEffort?: string | null
): CodexComposerReasoningEffortOption[] {
    const normalizedCurrentEffort = normalizeCodexComposerReasoningEffort(currentEffort)
    const normalizedDefaultEffort = defaultEffort?.trim().toLowerCase() || null

    if (flavor === 'opencode') {
        if (!dynamicOptions || dynamicOptions.length === 0) {
            return []
        }
        return buildDynamicReasoningEffortOptions(normalizedCurrentEffort, dynamicOptions)
    }

    if (dynamicOptions && dynamicOptions.length > 0) {
        return buildDynamicReasoningEffortOptions(normalizedCurrentEffort, dynamicOptions, normalizedDefaultEffort)
    }

    return buildReasoningEffortOptions(
        normalizedCurrentEffort,
        CODEX_REASONING_EFFORT_PRESETS.map((effort) => ({
            value: effort,
            label: CODEX_REASONING_EFFORT_LABELS[effort]
        })),
        normalizedDefaultEffort
    )
}
