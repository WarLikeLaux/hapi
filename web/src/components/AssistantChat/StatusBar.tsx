import {
    getCodexCollaborationModeLabel,
    getCopilotAgentModeLabel,
    getPermissionModeLabel,
    getPermissionModeTone,
    isPermissionModeAllowedForFlavor
} from '@hapi/protocol'
import type { PermissionModeTone } from '@hapi/protocol'
import * as Popover from '@radix-ui/react-popover'
import { useMemo } from 'react'
import type { AgentState, CodexCollaborationMode, PermissionMode } from '@/types/api'
import type { ConversationStatus } from '@/realtime/types'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import {
    formatReasoningLabel,
    formatCompactReasoningLabel,
    getReasoningEffortForFlavor,
    shouldShowReasoningStatusLabel
} from '@/lib/codexStatusLabels'
import { isFastServiceTier } from './codexFastMode'
import { useTranslation } from '@/lib/use-translation'
import { useSessionHeaderMetadata } from '@/hooks/useSessionHeaderMetadata'

export const WORKING_STATUS_MESSAGES = [
    'ебусь с этой штукой', 'разъёбываю задачу', 'ищу, где насрали',
    'делаю, чтоб не стыдно', 'код опять пиздит', 'читаю логи-улики',
    'ищу подозреваемого', 'пинаю тесты', 'копаю древнее говно',
    'разгребаю бардак', 'душу баг фактами', 'торгуюсь с компилятором',
    'всё под контролем', 'нашёл ниточку, тяну', 'копаю, где страшно',
    'собираю фикс', 'проверяю алиби строк', 'убираю техпиздец',
    'ищу, что отъебнулось', 'делаю 67 движений', 'сикс севен, почти',
    'двигаю байты', 'успокаиваю код', 'чиню самопочиняемое',
    'страдаю над легаси', 'докручиваю до заебись', 'укрепляю костыли',
    'проверяю план', 'стучу по коду', 'ещё немного страдаю'
]

export const READY_STATUS_MESSAGES = [
    'готов ебашить', 'жив и на связи', 'заряжен', 'можно наваливать',
    'всё, я свободен', 'готов к новой хуйне', 'скучаю без задачи',
    'бодр и подозрителен', 'жду приколов', 'готов лезть в код',
    'не потерялся', 'сикс севен, готов'
]

function pickStatusMessage(messages: readonly string[]): string {
    return messages[Math.floor(Math.random() * messages.length)] ?? messages[0] ?? ''
}

const PERMISSION_TONE_CLASSES: Record<PermissionModeTone, string> = {
    neutral: 'text-[var(--app-hint)]',
    info: 'text-blue-500',
    warning: 'text-amber-500',
    danger: 'text-red-500'
}

const CONTEXT_WARNING_THRESHOLD_PERCENT = 70
const CONTEXT_DANGER_THRESHOLD_PERCENT = 90

function getConnectionStatus(
    active: boolean,
    thinking: boolean,
    agentState: AgentState | null | undefined,
    voiceStatus: ConversationStatus | undefined,
    backgroundTaskCount: number,
    t: (key: string) => string
): { text: string; color: string; dotColor: string; isPulsing: boolean } {
    const hasPermissions = agentState?.requests && Object.keys(agentState.requests).length > 0

    // Voice connecting takes priority
    if (voiceStatus === 'connecting') {
        return {
            text: t('voice.connecting'),
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    if (!active) {
        return {
            text: t('misc.offline'),
            color: 'text-[#999]',
            dotColor: 'bg-[#999]',
            isPulsing: false
        }
    }

    if (hasPermissions) {
        return {
            text: t('misc.permissionRequired'),
            color: 'text-[#FF9500]',
            dotColor: 'bg-[#FF9500]',
            isPulsing: true
        }
    }

    if (thinking) {
        return {
            text: `${pickStatusMessage(WORKING_STATUS_MESSAGES)}…`,
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    if (backgroundTaskCount > 0) {
        return {
            text: `${backgroundTaskCount} background task${backgroundTaskCount > 1 ? 's' : ''} running`,
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    return {
        text: pickStatusMessage(READY_STATUS_MESSAGES),
        color: 'text-[#34C759]',
        dotColor: 'bg-[#34C759]',
        isPulsing: false
    }
}

export function getContextWarning(contextSize: number, maxContextSize: number): { color: string } {
    const percentageUsed = (contextSize / maxContextSize) * 100

    if (percentageUsed >= CONTEXT_DANGER_THRESHOLD_PERCENT) {
        return { color: 'text-red-500' }
    } else if (percentageUsed >= CONTEXT_WARNING_THRESHOLD_PERCENT) {
        return { color: 'text-amber-500' }
    } else {
        return { color: 'text-[var(--app-hint)]' }
    }
}

function formatTokenCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`
    return String(value)
}

function getContextPercentages(contextSize: number, maxContextSize: number): {
    usedPercentage: number
    remainingPercentage: number
} {
    const usedPercentage = Math.min(100, Math.max(0, Math.round((contextSize / maxContextSize) * 100)))
    return { usedPercentage, remainingPercentage: 100 - usedPercentage }
}

export function formatContextUsageLabel(contextSize: number, maxContextSize: number | null | undefined): string {
    if (!maxContextSize) return `${formatTokenCount(contextSize)} used`
    const { usedPercentage } = getContextPercentages(contextSize, maxContextSize)
    return `${usedPercentage}% · ${formatTokenCount(contextSize)} / ${formatTokenCount(maxContextSize)}`
}

export function getContextUsageDetails(
    contextSize: number,
    maxContextSize: number | null | undefined,
    contextCacheRead: number | null | undefined
): {
    cacheRead: string | null
    used: string
    usedPercentage: number | null
    remaining: string | null
    remainingPercentage: number | null
} {
    if (!maxContextSize) {
        return {
            cacheRead: contextCacheRead && contextCacheRead > 0 ? formatTokenCount(contextCacheRead) : null,
            used: formatTokenCount(contextSize),
            usedPercentage: null,
            remaining: null,
            remainingPercentage: null
        }
    }

    const { usedPercentage, remainingPercentage } = getContextPercentages(contextSize, maxContextSize)
    return {
        cacheRead: contextCacheRead && contextCacheRead > 0 ? formatTokenCount(contextCacheRead) : null,
        used: formatTokenCount(contextSize),
        usedPercentage,
        remaining: formatTokenCount(Math.max(0, maxContextSize - contextSize)),
        remainingPercentage
    }
}

export function shouldShowCodexFastBadge(
    agentFlavor: string | null | undefined,
    serviceTier: string | null | undefined
): boolean {
    return agentFlavor === 'codex' && isFastServiceTier(serviceTier)
}

export function StatusBar(props: {
    active: boolean
    thinking: boolean
    agentState: AgentState | null | undefined
    backgroundTaskCount?: number
    contextSize?: number
    contextCacheRead?: number
    contextWindow?: number | null
    /**
     * Model to use for the context-window fallback heuristic when
     * contextWindow is absent. Falls back to `model`. Callers pass the
     * usage-bearing message's own model here so local Claude sessions (whose
     * session.model is often null) still resolve a plausible window.
     */
    contextModel?: string | null
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    serviceTier?: string | null
    permissionMode?: PermissionMode
    collaborationMode?: CodexCollaborationMode
    copilotAgentMode?: import('@hapi/protocol').CopilotAgentMode
    agentFlavor?: string | null
    voiceStatus?: ConversationStatus
}) {
    const { t } = useTranslation()
    const { preferences: headerMetadata } = useSessionHeaderMetadata()
    const connectionStatus = useMemo(
        () => getConnectionStatus(props.active, props.thinking, props.agentState, props.voiceStatus, props.backgroundTaskCount ?? 0, t),
        [props.active, props.thinking, props.agentState, props.voiceStatus, props.backgroundTaskCount, t]
    )

    const contextHeuristicModel = props.contextModel ?? props.model
    const contextWarning = useMemo(
        () => {
            if (props.contextSize === undefined) return null
            const maxContextSize = props.contextWindow ?? getContextBudgetTokens(contextHeuristicModel, props.agentFlavor)
            if (!maxContextSize) return null
            return getContextWarning(props.contextSize, maxContextSize)
        },
        [props.contextSize, props.contextWindow, contextHeuristicModel, props.agentFlavor]
    )
    const contextUsageLabel = useMemo(() => {
        if (props.contextSize === undefined) return null
        const maxContextSize = props.contextWindow ?? getContextBudgetTokens(contextHeuristicModel, props.agentFlavor)
        return formatContextUsageLabel(props.contextSize, maxContextSize)
    }, [props.contextSize, props.contextWindow, contextHeuristicModel, props.agentFlavor])
    const contextUsageDetails = useMemo(() => {
        if (props.contextSize === undefined) return null
        const maxContextSize = props.contextWindow ?? getContextBudgetTokens(contextHeuristicModel, props.agentFlavor)
        return getContextUsageDetails(props.contextSize, maxContextSize, props.contextCacheRead)
    }, [props.contextSize, props.contextCacheRead, props.contextWindow, contextHeuristicModel, props.agentFlavor])
    const contextUsedPercentage = contextUsageDetails?.usedPercentage ?? null

    const permissionMode = props.permissionMode
    // Copilot always shows permission (including Default) so model=auto sessions
    // still surface the bottom-right mode chip. Other flavors keep Codex-style
    // "hide default" parity.
    const displayPermissionMode = permissionMode
        && isPermissionModeAllowedForFlavor(permissionMode, props.agentFlavor)
        && (permissionMode !== 'default' || props.agentFlavor === 'copilot')
        ? permissionMode
        : null

    const permissionModeLabel = displayPermissionMode ? getPermissionModeLabel(displayPermissionMode) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const permissionModeColor = permissionModeTone ? PERMISSION_TONE_CLASSES[permissionModeTone] : 'text-[var(--app-hint)]'
    const displayCollaborationMode = props.agentFlavor === 'codex' && props.collaborationMode === 'plan'
        ? props.collaborationMode
        : null
    const collaborationModeLabel = displayCollaborationMode
        ? getCodexCollaborationModeLabel(displayCollaborationMode)
        : null
    const displayCopilotAgentMode = props.agentFlavor === 'copilot'
        && props.copilotAgentMode
        && props.copilotAgentMode !== 'interactive'
        ? props.copilotAgentMode
        : null
    const copilotAgentModeLabel = displayCopilotAgentMode
        ? getCopilotAgentModeLabel(displayCopilotAgentMode)
        : null
    const reasoningEffort = getReasoningEffortForFlavor(
        props.agentFlavor,
        props.modelReasoningEffort,
        props.effort
    )
    const displaysReasoning = shouldShowReasoningStatusLabel(props.agentFlavor, reasoningEffort)
    const reasoningLabel = displaysReasoning
        ? formatReasoningLabel(reasoningEffort, headerMetadata.showLabels)
        : null
    const compactReasoningLabel = displaysReasoning
        ? formatCompactReasoningLabel(reasoningEffort)
        : null
    const codexFastMode = shouldShowCodexFastBadge(props.agentFlavor, props.serviceTier)

    return (
        <div className="flex min-w-0 items-baseline justify-between gap-2 px-2 pb-1">
            <div className="flex min-w-0 items-baseline gap-2">
                <div className="relative top-px sm:top-0.5 flex shrink-0 items-center gap-1.5">
                    <span
                        className={`h-2 w-2 rounded-full ${connectionStatus.dotColor} ${connectionStatus.isPulsing ? 'animate-pulse' : ''}`}
                    />
                    <span className={`whitespace-nowrap text-xs ${connectionStatus.color}`}>
                        {connectionStatus.text}
                    </span>
                </div>
                {contextUsageLabel ? (
                    <Popover.Root>
                        <Popover.Trigger asChild>
                            <button
                                type="button"
                                aria-label={t('misc.contextDetails')}
                                className={`hidden min-w-0 cursor-pointer whitespace-nowrap rounded-sm bg-transparent p-0 text-[10px] leading-4 outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-link)] sm:inline-flex ${contextWarning?.color ?? 'text-[var(--app-hint)]'}`}
                            >
                                <span className="inline-flex items-center gap-2">
                                    {contextUsedPercentage !== null ? (
                                        <span
                                            aria-hidden="true"
                                            className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--app-link-muted)]"
                                        >
                                            <span
                                                className="block h-full rounded-full bg-current"
                                                style={{ width: `${contextUsedPercentage}%` }}
                                            />
                                        </span>
                                    ) : null}
                                    <span>{contextUsageLabel}</span>
                                </span>
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                side="top"
                                align="start"
                                sideOffset={6}
                                collisionPadding={8}
                                className="z-50 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 shadow-lg"
                            >
                                <div className="flex max-w-[min(22rem,calc(100vw-1rem))] flex-col gap-1 text-xs leading-tight text-[var(--app-fg)]">
                                    {contextUsageDetails?.cacheRead ? (
                                        <span className="break-words">
                                            {t('misc.contextCache', { value: contextUsageDetails.cacheRead })}
                                        </span>
                                    ) : null}
                                    <span className="break-words">
                                        {contextUsageDetails?.usedPercentage === null
                                            ? t('misc.contextUsedTokens', { value: contextUsageDetails.used })
                                            : t('misc.contextUsed', {
                                                value: contextUsageDetails?.used ?? '',
                                                percent: contextUsageDetails?.usedPercentage ?? 0
                                            })}
                                    </span>
                                    {contextUsageDetails?.remaining && contextUsageDetails.remainingPercentage !== null ? (
                                        <span className="break-words">
                                            {t('misc.contextRemaining', {
                                                value: contextUsageDetails.remaining,
                                                percent: contextUsageDetails.remainingPercentage
                                            })}
                                        </span>
                                    ) : null}
                                </div>
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                ) : null}
            </div>

            <div className="flex min-w-0 shrink-0 items-baseline gap-2">
                {reasoningLabel ? (
                    <span className="whitespace-nowrap text-xs text-[var(--app-hint)]">
                        <span className="sm:hidden">{compactReasoningLabel}</span>
                        <span className="hidden sm:inline">{reasoningLabel}</span>
                    </span>
                ) : null}
                {codexFastMode ? (
                    <span className="whitespace-nowrap text-xs text-[#34C759]">
                        fast
                    </span>
                ) : null}
                {collaborationModeLabel ? (
                    <span className="whitespace-nowrap text-xs text-blue-500">
                        {collaborationModeLabel}
                    </span>
                ) : null}
                {copilotAgentModeLabel ? (
                    <span className="whitespace-nowrap text-xs text-blue-500">
                        {copilotAgentModeLabel}
                    </span>
                ) : null}
                {displayPermissionMode ? (
                    <span className={`whitespace-nowrap text-xs ${permissionModeColor}`}>
                        {permissionModeLabel}
                    </span>
                ) : null}
            </div>
        </div>
    )
}
