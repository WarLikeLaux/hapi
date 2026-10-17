import { isFastServiceTier } from '@/components/AssistantChat/codexFastMode'
import { parseCursorWireParams } from './cursorModelOptions'

/** Uses the effective Codex tier or the active Cursor variant, never effort. */
export function isSessionFastMode(
    agentFlavor: string | null | undefined,
    serviceTier: string | null | undefined,
    model?: string | null
): boolean {
    if (agentFlavor === 'codex') return isFastServiceTier(serviceTier)
    if (agentFlavor !== 'cursor' || !model) return false
    const fastParam = parseCursorWireParams(model).fast
    return fastParam !== undefined
        ? fastParam.toLowerCase() === 'true'
        : /-fast$/i.test(model.trim())
}
