import { useSyncExternalStore } from 'react'
import { applyClaudeGlmBranding } from '@hapi/protocol'

/**
 * Fork hook: the hub setting `claudeBrandedAsGlm` labels claude-flavor
 * sessions as GLM (z.ai). This tiny store carries that flag through the
 * web app without dragging react-query providers into every icon.
 *
 * `setClaudeGlmBranded` is called by the app-root sync observer
 * (`ClaudeGlmBrandingSync`) whenever the hub settings query resolves;
 * `useClaudeGlmBranding` subscribers (labels, AgentFlavorIcon) re-render
 * from the store, and `applyClaudeGlmBranding` keeps shared
 * `getFlavorLabel()` output in step.
 */

let branded = false

const listeners = new Set<() => void>()

export function setClaudeGlmBranded(next: boolean): void {
    if (next === branded) {
        return
    }
    branded = next
    applyClaudeGlmBranding(next)
    for (const listener of listeners) {
        listener()
    }
}

export function getClaudeGlmBranded(): boolean {
    return branded
}

export function subscribeClaudeGlmBranding(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useClaudeGlmBranding(): boolean {
    return useSyncExternalStore(subscribeClaudeGlmBranding, getClaudeGlmBranded)
}
