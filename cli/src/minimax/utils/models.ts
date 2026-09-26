import type { MinimaxModelSummary, MinimaxModelsResponse } from '@hapi/protocol/apiTypes';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';

/**
 * Model catalog of the *live* ACP session. The remote launcher publishes the
 * config-option snapshot (`category: 'model'`) after session creation, mode
 * changes, and prompt completion; the session-scoped `ListMinimaxModels` RPC
 * serves it to the web model picker.
 *
 * Unlike the Kimi flavor there is no fresh-process probe: `mcode acp` has no
 * side-effect-free catalog command (plan-sourced models only appear on a
 * session), and a throwaway probe session would litter mcode's own store.
 */
type LiveMinimaxCatalog = {
    models: MinimaxModelSummary[];
    currentModelId: string | null;
};

let liveCatalog: LiveMinimaxCatalog | null = null;

export function publishLiveMinimaxCatalog(catalog: LiveMinimaxCatalog | null): void {
    liveCatalog = catalog;
}

export function getLiveMinimaxCatalogResponse(): MinimaxModelsResponse {
    if (!liveCatalog) {
        return { success: false, error: 'MiniMax session model catalog is not available yet' };
    }
    return {
        success: true,
        availableModels: liveCatalog.models,
        currentModelId: liveCatalog.currentModelId
    };
}

/**
 * Session-scoped discovery for a running MiniMax session. Registered by the
 * session runner (not the launcher) so the picker can answer as soon as the
 * launcher publishes the catalog.
 */
export function registerMinimaxSessionModelHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<unknown, MinimaxModelsResponse>(
        RPC_METHODS.ListMinimaxModels,
        async () => getLiveMinimaxCatalogResponse()
    );
}

export function toMinimaxModelSummaries(
    options: Array<{ value: string; name?: string }> | undefined
): MinimaxModelSummary[] {
    if (!options) {
        return [];
    }
    return options.map((option) => ({
        modelId: option.value,
        ...(option.name ? { name: option.name } : {})
    }));
}
