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

/** Hardcoded cursor models: literal wire ids, no catalog lookup. */
export const CURSOR_GROK_XHIGH_WIRE = 'grok-4.7-xhigh'
export const CURSOR_COMPOSER_FAST_WIRE = 'composer-2.5-fast'

export function isHardcodedCursorModelId(modelId: string | null | undefined): boolean {
    if (!modelId) return false
    const lower = modelId.toLowerCase()
    return lower === CURSOR_GROK_XHIGH_WIRE || lower === CURSOR_COMPOSER_FAST_WIRE
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
