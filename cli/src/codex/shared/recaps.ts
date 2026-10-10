import { record, string, type Envelope } from './gateway';

export type NativeRecapTarget = { publish(text: string, id: string): void };
type RecapThread = {
    connection: string;
    target: NativeRecapTarget;
    recap: boolean;
    turnId?: string;
    text?: string;
};

/** Mirror the TUI's temporary recap response into its displayed HAPI root.
 * Temporary threads have no parent ID and no persisted transcript. Associate
 * them with the connection's displayed root at creation, never a later /new.
 */
export class NativeCodexRecaps {
    private readonly displayed = new Map<string, string>();
    private readonly pending = new Map<string, NativeRecapTarget>();
    private readonly threads = new Map<string, RecapThread>();

    constructor(private readonly capture: (threadId: string) => NativeRecapTarget | undefined) {}

    before(request: Envelope, connection: string): void {
        const p = record(request.params);
        if (request.method === 'thread/start' && p.ephemeral === true && request.id !== undefined) {
            const root = this.displayed.get(connection);
            const target = root ? this.capture(root) : undefined;
            if (target) this.pending.set(this.key(connection, request.id), target);
        }
        const thread = this.threads.get(string(p.threadId) ?? '');
        if (!thread || thread.connection !== connection) return;
        if (request.method === 'turn/start') {
            const schema = record(p.outputSchema);
            const properties = record(schema.properties);
            const input = Array.isArray(p.input) ? p.input : [];
            const prompt = input.filter(value => record(value).type === 'text')
                .map(value => string(record(value).text) ?? '').join('\n');
            // This is the native recap contract, not an arbitrary temporary
            // thread (titles, predictions and other TUI requests use these too).
            thread.recap = prompt.startsWith('Write a brief catch-up for a user returning to this task.')
                && schema.type === 'object'
                && record(properties.summary).type === 'string'
                && Array.isArray(record(properties.next_action).type)
                && (record(properties.next_action).type as unknown[]).includes('string')
                && (record(properties.next_action).type as unknown[]).includes('null')
                && Array.isArray(schema.required) && schema.required.includes('summary') && schema.required.includes('next_action');
            thread.turnId = undefined;
            thread.text = undefined;
        }
        if (request.method === 'thread/unsubscribe') this.threads.delete(string(p.threadId)!);
    }

    after(request: Envelope, response: Envelope, connection: string): void {
        if (!['thread/start', 'thread/resume', 'thread/fork'].includes(request.method ?? '')) return;
        const key = request.id === undefined ? undefined : this.key(connection, request.id);
        const target = key ? this.pending.get(key) : undefined;
        if (key) this.pending.delete(key);
        if (response.error) return;
        const threadId = string(record(record(response.result).thread).id);
        if (!threadId) return;
        if (record(request.params).ephemeral === true) {
            if (target) this.threads.set(threadId, { connection, target, recap: false });
        } else {
            if (this.capture(threadId)) this.displayed.set(connection, threadId);
            else this.displayed.delete(connection);
        }
    }

    observe(message: Envelope, connection: string): void {
        const p = record(message.params);
        const threadId = string(p.threadId);
        const thread = threadId ? this.threads.get(threadId) : undefined;
        if (!thread || thread.connection !== connection || !thread.recap) return;
        if (message.method === 'turn/started') thread.turnId = string(record(p.turn).id);
        if (message.method === 'item/completed' && p.turnId === thread.turnId && record(p.item).type === 'agentMessage') {
            const text = string(record(p.item).text);
            if (text && text.length <= 8_192) thread.text = text;
        }
        if (message.method !== 'turn/completed' || !thread.turnId || record(p.turn).id !== thread.turnId) return;
        this.threads.delete(threadId!);
        if (record(p.turn).status !== 'completed' || !thread.text) return;
        try {
            const recap = record(JSON.parse(thread.text));
            if (Object.keys(recap).some(key => key !== 'summary' && key !== 'next_action')) return;
            const summary = string(recap.summary)?.trim();
            const next = recap.next_action === null ? '' : typeof recap.next_action === 'string' ? recap.next_action.trim() : undefined;
            if (!summary || [...summary].length > 700 || next === undefined || [...next].length > 200) return;
            thread.target.publish(next ? `${summary}\n${next}` : summary, `codex-recap:${threadId}:${thread.turnId}`);
        } catch { /* A failed native structured response is not visible content. */ }
    }

    disconnected(connection: string): void {
        this.displayed.delete(connection);
        for (const key of this.pending.keys()) if (key.startsWith(`${connection}:`)) this.pending.delete(key);
        for (const [id, thread] of this.threads) if (thread.connection === connection) this.threads.delete(id);
    }

    private key(connection: string, id: string | number): string { return `${connection}:${typeof id}:${id}`; }
}
