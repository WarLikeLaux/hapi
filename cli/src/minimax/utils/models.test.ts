import { afterEach, describe, expect, it } from 'vitest';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import {
    getLiveMinimaxCatalogResponse,
    publishLiveMinimaxCatalog,
    registerMinimaxSessionModelHandlers,
    toMinimaxModelSummaries
} from './models';

describe('minimax live model catalog', () => {
    afterEach(() => {
        publishLiveMinimaxCatalog(null);
    });

    it('serves an error before the launcher publishes a catalog', () => {
        expect(getLiveMinimaxCatalogResponse()).toEqual({
            success: false,
            error: 'MiniMax session model catalog is not available yet'
        });
    });

    it('serves the published catalog', () => {
        publishLiveMinimaxCatalog({
            models: toMinimaxModelSummaries([
                { value: 'm:minimax:MiniMax-M3:v:thinking', name: 'MiniMax-M3 · thinking' },
                { value: 'm:minimax:MiniMax-M3:v:' }
            ]),
            currentModelId: 'm:minimax:MiniMax-M3:v:thinking'
        });
        expect(getLiveMinimaxCatalogResponse()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'm:minimax:MiniMax-M3:v:thinking', name: 'MiniMax-M3 · thinking' },
                { modelId: 'm:minimax:MiniMax-M3:v:' }
            ],
            currentModelId: 'm:minimax:MiniMax-M3:v:thinking'
        });
    });

    it('registers the ListMinimaxModels session RPC', () => {
        const handlers = new Map<string, (data: unknown) => Promise<unknown>>();
        const rpcHandlerManager = {
            registerHandler: (method: string, handler: (data: unknown) => Promise<unknown>) => {
                handlers.set(method, handler);
            }
        } as unknown as RpcHandlerManager;

        registerMinimaxSessionModelHandlers(rpcHandlerManager);
        expect(handlers.has(RPC_METHODS.ListMinimaxModels)).toBe(true);
    });
});
