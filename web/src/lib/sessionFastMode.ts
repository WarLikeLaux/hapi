import { getDisplayedCodexServiceTier } from '@/components/AssistantChat/codexFastMode'
import { parseCursorWireParams } from './cursorModelOptions'

/** Uses the effective Codex tier or the active Cursor variant, never effort. */
export function getSessionSpeedLabel(
    agentFlavor: string | null | undefined,
    serviceTier: string | null | undefined,
    model?: string | null
): 'Fast' | 'Ultrafast' | undefined {
    if (agentFlavor === 'codex') {
        const speed = getDisplayedCodexServiceTier(serviceTier)
        if (speed === 'ultrafast') return 'Ultrafast'
        return speed === 'fast' ? 'Fast' : undefined
    }
    if (agentFlavor !== 'cursor' || !model) return undefined
    const fastParam = parseCursorWireParams(model).fast
    const fast = fastParam !== undefined
        ? fastParam.toLowerCase() === 'true'
        : /-fast$/i.test(model.trim())
    return fast ? 'Fast' : undefined
}
