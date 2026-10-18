import type { AgentFlavor } from '@hapi/protocol'
import {
    buildCursorCatalogFromSources,
    buildCursorPickerState,
    pickCursorModelsForPicker,
    resolveCursorBaseFromWire,
    resolveWireIdForBaseChange,
    type CursorPickerState
} from '@/lib/cursorPickerState'
import type { CursorModelCatalog } from '@/lib/cursorModelOptions'
import type { CursorModelSummary } from '@/types/api'

export function shouldShowCursorModelsUnavailable(args: {
    agent: AgentFlavor
    isLoading: boolean
    error: string | null
    availableModels: readonly CursorModelSummary[]
}): boolean {
    return args.agent === 'cursor'
        && !args.isLoading
        && !args.error
        && pickCursorModelsForPicker(args.availableModels).length === 0
}

export function buildNewSessionCursorModelCatalog(
    availableModels: readonly CursorModelSummary[],
    currentModel: string,
    cliModelSkus?: readonly CursorModelSummary[]
): CursorModelCatalog {
    return buildCursorCatalogFromSources({
        sessionModels: [],
        machineModels: availableModels,
        cliModelSkus,
        sessionModelFromHub: currentModel !== 'auto' ? currentModel : null,
        defaultValue: 'auto'
    })
}

export function buildNewSessionCursorPickerState(
    machineModels: readonly CursorModelSummary[],
    currentModel: string,
    cliModelSkus?: readonly CursorModelSummary[]
): CursorPickerState {
    const catalog = buildNewSessionCursorModelCatalog(machineModels, currentModel, cliModelSkus)
    return buildCursorPickerState({
        catalog,
        currentWireId: currentModel,
        defaultValue: 'auto'
    })
}

export function buildNewSessionCursorModelOptions(
    picker: CursorPickerState
): CursorPickerState['modelOptions'] {
    return picker.modelOptions
}

export function buildNewSessionCursorEffortOptions(
    picker: CursorPickerState
): CursorPickerState['effortOptions'] {
    return picker.effortOptions
}

export function shouldShowNewSessionCursorVariantPicker(picker: CursorPickerState): boolean {
    return picker.mode === 'dual' && picker.showEffortPicker && picker.effortOptions.length > 1
}

/** Hardcoded cursor models: literal wire ids, no catalog lookup. Fast is the `-fast` suffix of these. */
export const CURSOR_GROK_XHIGH_WIRE = 'grok-4.7-xhigh'
export const CURSOR_COMPOSER_STANDARD_WIRE = 'composer-2.5'

/** Only advertise Speed when discovery provides both wires for the same model/effort. */
export function getCursorModelSpeedOptions(modelId: string, models: readonly CursorModelSummary[]): { standard: string; fast: string } | null {
    if (modelId === 'auto' || modelId === 'default[]') return null
    function identity(wire: string): { key: string; fast: boolean } {
        const bracket = wire.indexOf('[')
        if (bracket === -1) return { key: wire.replace(/-fast$/, ''), fast: wire.endsWith('-fast') }
        const params = wire.slice(bracket + 1, -1).split(',').filter(Boolean)
        return {
            key: wire.slice(0, bracket) + params.filter(param => !param.startsWith('fast=')).sort().join(','),
            fast: params.includes('fast=true'),
        }
    }
    const selected = identity(modelId)
    const matching = models.filter(model => identity(model.modelId).key === selected.key)
    const standard = matching.find(model => model.modelId === modelId && !selected.fast)
        ?? matching.find(model => !identity(model.modelId).fast)
    const fast = matching.find(model => identity(model.modelId).fast)
    return standard && fast ? { standard: standard.modelId, fast: fast.modelId } : null
}

/** Map the live Cursor model or its verbose display name onto a hardcoded quick pick. */
export function resolveCursorQuickPickValue(
    currentModelId: string | null | undefined,
    defaultName: string | null | undefined
): string | undefined {
    const blob = `${currentModelId ?? ''}\n${defaultName ?? ''}`.toLowerCase()
    if (/grok[- ]4[.-]7/.test(blob)) return CURSOR_GROK_XHIGH_WIRE
    if (/composer[- ]2[.-]5/.test(blob)) return CURSOR_COMPOSER_STANDARD_WIRE
    return undefined
}

/** Fast tier of the live Cursor selection, including parameterized `fast=true` wires. */
export function cursorSelectionIsFast(
    modelId: string | null | undefined,
    defaultName?: string | null
): boolean {
    if (modelId && modelId !== 'auto' && modelId !== 'default[]') {
        const bracket = modelId.indexOf('[')
        if (bracket !== -1) {
            return modelId.slice(bracket + 1, -1).split(',').some(param => param.trim() === 'fast=true')
        }
        return /-fast$/i.test(modelId)
    }
    return /\bfast\b/i.test(defaultName ?? '')
}

export function isHardcodedCursorModelId(modelId: string | null | undefined): boolean {
    if (!modelId) return false
    const lower = modelId.toLowerCase()
    const standard = lower.replace(/-fast$/, '')
    return standard === CURSOR_GROK_XHIGH_WIRE || standard === CURSOR_COMPOSER_STANDARD_WIRE
}
export function resolveCursorDefaultModelId(catalog: CursorModelCatalog): string | null {
    const wires: string[] = []
    for (const variants of catalog.variantsByBase.values()) {
        for (const entry of variants) wires.push(entry.wireId)
    }
    const lower = (s: string) => s.toLowerCase()
    const isGrok47 = (w: string) => lower(w).includes('grok-4.7') || lower(w).includes('grok-4-7')
    const isExtraHigh = (w: string) => lower(w).includes('extra-high') || lower(w).includes('extra_high') || lower(w).includes('extrahigh') || lower(w).includes('xhigh')
    const grok47 = wires.filter(isGrok47)
    if (grok47.length === 0) return null
    return grok47.find(isExtraHigh) ?? grok47.find((w) => lower(w).includes('high')) ?? grok47[0]
}

/** Quick-pick wire for cursor: composer-2.5 fast variant, shown as a chip like gpt-6-luna. */
export function resolveCursorQuickPickFastId(catalog: CursorModelCatalog): string | null {
    const wires: string[] = []
    for (const variants of catalog.variantsByBase.values()) {
        for (const entry of variants) wires.push(entry.wireId)
    }
    const lower = (s: string) => s.toLowerCase()
    return wires.find((w) => lower(w).includes('composer-2.5') && (lower(w).includes('fast=true') || lower(w).endsWith('-fast'))) ?? null
}
export function resolveNewSessionCursorBaseSelectValue(
    picker: CursorPickerState,
    cursorSelectedBase: string
): string {
    if (picker.mode !== 'dual') {
        return picker.wireId ?? 'auto'
    }
    if (cursorSelectedBase !== 'auto') {
        return cursorSelectedBase
    }
    return 'auto'
}

/** Keep Effort <select> controlled when catalog reloads after Browse remount. */
export function resolveNewSessionCursorEffortSelectValue(
    model: string,
    effortOptions: readonly { value: string }[]
): string {
    if (effortOptions.length === 0) {
        return 'auto'
    }
    if (model !== 'auto' && effortOptions.some((row) => row.value === model)) {
        return model
    }
    return 'auto'
}

export function isCursorEffortWireAllowed(
    wireId: string,
    catalog: CursorModelCatalog,
    baseKey: string | null
): boolean {
    if (!baseKey || baseKey === 'auto') {
        return false
    }
    const variants = catalog.variantsByBase.get(baseKey) ?? []
    return variants.some((entry) => entry.wireId === wireId)
}

export { pickCursorModelsForPicker, resolveWireIdForBaseChange, resolveCursorBaseFromWire }
