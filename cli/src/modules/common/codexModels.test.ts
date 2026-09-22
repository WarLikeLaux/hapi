import { beforeEach, describe, expect, it, vi } from 'vitest';

const { constructorOptions, listModelsMock, configDefaultsMock } = vi.hoisted(() => ({
    constructorOptions: [] as unknown[],
    listModelsMock: vi.fn(),
    configDefaultsMock: vi.fn()
}));

vi.mock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return { ...actual, homedir: vi.fn(() => '/neutral-home') };
});

vi.mock('@/codex/utils/codexHome', () => ({
    readCodexConfigDefaults: () => configDefaultsMock()
}));

vi.mock('@/codex/codexAppServerClient', () => ({
    CodexAppServerClient: class {
        constructor(options: unknown) {
            constructorOptions.push(options);
        }

        async connect(): Promise<void> {}
        async initialize(): Promise<void> {}
        async listModels(): Promise<{ data: unknown[] }> {
            return listModelsMock();
        }
        async disconnect(): Promise<void> {}
    }
}));

import { listCodexModels, _resetCodexModelsCacheForTests } from './codexModels';

describe('listCodexModels cwd', () => {
    beforeEach(() => {
        constructorOptions.length = 0;
        listModelsMock.mockReset();
        configDefaultsMock.mockReset().mockReturnValue({ model: null, modelReasoningEffort: null });
        _resetCodexModelsCacheForTests();
    });

    it('starts discovery from the user home instead of the caller cwd', async () => {
        listModelsMock.mockResolvedValue({ data: [] });

        await listCodexModels();

        expect(constructorOptions).toEqual([{ cwd: '/neutral-home' }]);
    });

    it('caches the model list within the TTL so repeat calls skip the app-server spawn', async () => {
        listModelsMock.mockResolvedValue({
            data: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', isDefault: true }]
        });

        const first = await listCodexModels();
        const second = await listCodexModels();

        expect(first).toEqual([expect.objectContaining({
            id: 'gpt-5.6-sol',
            displayName: 'GPT-5.6-Sol',
            isDefault: true
        })]);
        expect(second).toEqual(first);
        expect(constructorOptions).toHaveLength(1);
        expect(listModelsMock).toHaveBeenCalledTimes(1);
    });

    it('keeps visible and hidden model lists in separate cache slots', async () => {
        listModelsMock.mockResolvedValue({ data: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }] });

        await listCodexModels(false);
        await listCodexModels(false);
        await listCodexModels(true);
        await listCodexModels(true);

        expect(constructorOptions).toHaveLength(2);
    });

    it('coalesces concurrent requests into a single app-server spawn', async () => {
        let resolveList: (value: { data: unknown[] }) => void = () => undefined;
        listModelsMock.mockImplementationOnce(
            () => new Promise((res) => { resolveList = res; })
        );

        const inflight1 = listCodexModels();
        const inflight2 = listCodexModels();

        // Allow the microtasks to schedule the first request before resolving it.
        await new Promise((resolve) => setImmediate(resolve));
        resolveList({ data: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }] });

        const [first, second] = await Promise.all([inflight1, inflight2]);

        expect(constructorOptions).toHaveLength(1);
        expect(listModelsMock).toHaveBeenCalledTimes(1);
        expect(first).toEqual(second);
        expect(first).toHaveLength(1);
    });

    it('expires the cache after the TTL so a later call respawns the app-server', async () => {
        vi.useFakeTimers();
        try {
            listModelsMock.mockResolvedValue({ data: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }] });

            await listCodexModels();
            expect(constructorOptions).toHaveLength(1);

            vi.advanceTimersByTime(5 * 60_000 + 1);
            await listCodexModels();
            expect(constructorOptions).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not cache empty or failed results', async () => {
        listModelsMock.mockResolvedValue({ data: [] });
        await listCodexModels();
        await listCodexModels();
        expect(constructorOptions).toHaveLength(2);

        listModelsMock.mockRejectedValue(new Error('app-server exploded'));
        await expect(listCodexModels()).rejects.toThrow('app-server exploded');
        await expect(listCodexModels()).rejects.toThrow('app-server exploded');
        expect(constructorOptions).toHaveLength(4);
    });
});

describe('listCodexModels config defaults', () => {
    beforeEach(() => {
        constructorOptions.length = 0;
        listModelsMock.mockReset();
        configDefaultsMock.mockReset().mockReturnValue({ model: null, modelReasoningEffort: null });
        _resetCodexModelsCacheForTests();
    });

    const CATALOG = [
        { id: 'gpt-6-astra', displayName: 'GPT-6-Astra', isDefault: true },
        { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', isDefault: false }
    ];

    it('re-pins the default marking to the config model and stamps the config effort', async () => {
        listModelsMock.mockResolvedValue({ data: CATALOG });
        configDefaultsMock.mockReturnValue({ model: 'gpt-6-sol', modelReasoningEffort: 'high' });

        const models = await listCodexModels();

        expect(models).toEqual([
            expect.objectContaining({ id: 'gpt-6-astra', isDefault: false }),
            expect.objectContaining({
                id: 'gpt-6-sol',
                isDefault: true,
                defaultReasoningEffort: 'high'
            })
        ]);
    });

    it('applies the config override to a cached catalog too, so an edited config shows up at once', async () => {
        listModelsMock.mockResolvedValue({ data: CATALOG });
        configDefaultsMock.mockReturnValue({ model: null, modelReasoningEffort: null });
        await listCodexModels();

        configDefaultsMock.mockReturnValue({ model: 'gpt-6-sol', modelReasoningEffort: 'high' });
        const models = await listCodexModels();

        expect(listModelsMock).toHaveBeenCalledTimes(1);
        expect(models.find((model) => model.id === 'gpt-6-sol')).toMatchObject({
            isDefault: true,
            defaultReasoningEffort: 'high'
        });
    });

    it('matches the config model case-insensitively and leaves the catalog alone when it is absent', async () => {
        listModelsMock.mockResolvedValue({ data: CATALOG });
        configDefaultsMock.mockReturnValue({ model: 'GPT-6-SOL', modelReasoningEffort: null });

        const matched = await listCodexModels();
        expect(matched.find((model) => model.id === 'gpt-6-sol')).toMatchObject({ isDefault: true });
        expect(matched.find((model) => model.id === 'gpt-6-sol')?.defaultReasoningEffort).toBeNull();

        configDefaultsMock.mockReturnValue({ model: 'gpt-9-vanished', modelReasoningEffort: 'high' });
        const unmatched = await listCodexModels();
        expect(unmatched.find((model) => model.id === 'gpt-6-astra')).toMatchObject({ isDefault: true });
    });
});
