import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { CODEX_WEBSOCKET_MAX_PAYLOAD } from '../websocketLimits';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.length ? value : undefined; }

export type CodexCompactionInfo = { summary?: string; estimatedTokensAfter?: number };
export type CodexTurnTiming = {
    timeToFirstTokenMs?: number;
    generation?: { start: number; end: number; outputTokens: number };
};

function count(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestamp(value: unknown): number | undefined {
    const ms = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : undefined;
}

type LookupOptions = { attempts?: number; sleep?: () => Promise<void> };

/** Incrementally reads a rollout identified by native thread/read or resume. */
export class CodexRolloutLookup {
    private path?: string;
    private identity?: string;
    private offset = 0;
    private mtime = 0;
    private partial = Buffer.alloc(0);
    private verified = false;
    private first = true;
    private turn?: string;
    private turnStartedAt?: number;
    private response?: { end: number; outputTokens: number };
    private pending?: { turn: string; info: CodexCompactionInfo; ambiguous: boolean; contextSeen: boolean; estimateAllowed: boolean; estimateCount: number };
    private work: Promise<unknown> = Promise.resolve();
    private readonly turnTimings = new Map<string, CodexTurnTiming>();
    private readonly compactions = new Map<string, CodexCompactionInfo | null>();

    constructor(private readonly threadId: string) {}

    private reset(): void {
        this.offset = 0; this.partial = Buffer.alloc(0); this.verified = false; this.first = true;
        this.turn = undefined; this.turnStartedAt = undefined; this.response = undefined;
        this.pending = undefined; this.compactions.clear(); this.turnTimings.clear();
    }

    private line(line: string): void {
        let event: Record<string, unknown>;
        try { event = record(JSON.parse(line)); }
        catch { if (this.first) { this.first = false; this.verified = false; } this.pending = undefined; return; }
        const payload = record(event.payload);
        if (this.first) {
            this.first = false;
            const ids = [text(payload.id), text(payload.session_id)].filter(Boolean);
            this.verified = event.type === 'session_meta' && ids.length > 0 && ids.every(id => id === this.threadId);
            return;
        }
        if (!this.verified) return;
        if (event.type === 'compacted') {
            const turn = text(record(payload.resume_metadata).last_started_turn_id);
            if (!turn || turn !== this.turn) { this.pending = undefined; return; }
            this.pending = { turn, info: typeof payload.message === 'string' && payload.message.trim() ? { summary: payload.message } : {},
                ambiguous: this.pending !== undefined, contextSeen: false, estimateAllowed: true, estimateCount: 0 };
            return;
        }
        if (this.pending && event.type === 'turn_context') {
            this.pending.contextSeen = payload.turn_id === this.pending.turn;
            if (!this.pending.contextSeen) {
                this.pending.estimateAllowed = false;
                delete this.pending.info.estimatedTokensAfter;
            }
        }
        if (this.pending && (event.type === 'response_item' || event.type === 'token_usage_record')) {
            this.pending.estimateAllowed = false;
            delete this.pending.info.estimatedTokensAfter;
        }
        if (event.type === 'token_usage_record' && this.turn && payload.turn_id === this.turn && payload.thread_id === this.threadId) {
            const end = timestamp(event.timestamp);
            // Native per-turn output already includes reasoning and earlier responses in this turn.
            const outputTokens = count(record(payload.turn_token_usage).output_tokens);
            this.response = end !== undefined && outputTokens !== undefined ? { end, outputTokens } : undefined;
        }
        if (event.type !== 'event_msg') return;
        if (payload.type === 'task_complete') {
            const id = text(payload.turn_id);
            const timeToFirstTokenMs = count(payload.time_to_first_token_ms);
            if (id) {
                const timing: CodexTurnTiming = { timeToFirstTokenMs };
                const completedAt = timestamp(event.timestamp);
                if (id === this.turn && this.turnStartedAt !== undefined && timeToFirstTokenMs !== undefined
                    && this.response && completedAt !== undefined) {
                    const start = this.turnStartedAt + timeToFirstTokenMs;
                    const { end, outputTokens } = this.response;
                    if (start < end && end <= completedAt && outputTokens > 0) timing.generation = { start, end, outputTokens };
                }
                this.turnTimings.set(id, timing);
            }
        }
        if (this.pending && payload.type === 'token_count' && payload.info != null) {
            const info = record(payload.info); const last = record(info.last_token_usage);
            // Native0.166 recompute_token_usage emits a retained-context estimate
            // after checkpoint installation/turn_context and before item completion.
            // Provider input/output usage and cumulative totals are different quantities.
            const estimate = last.total_tokens;
            const zeroUsage = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens']
                .every(field => last[field] === 0);
            if (this.pending.contextSeen && this.pending.estimateAllowed && info.last_usage_includes_reasoning === true
                && zeroUsage && typeof estimate === 'number' && Number.isSafeInteger(estimate) && estimate >= 0
                && this.pending.estimateCount++ === 0) {
                this.pending.info.estimatedTokensAfter = estimate;
            } else {
                this.pending.estimateAllowed = false;
                delete this.pending.info.estimatedTokensAfter;
            }
        }
        if (payload.type === 'task_started') {
            this.turn = text(payload.turn_id); this.turnStartedAt = timestamp(event.timestamp);
            this.response = undefined; this.pending = undefined;
        }
        if (['task_complete', 'turn_aborted', 'task_failed'].includes(String(payload.type))) this.pending = undefined;
        if (payload.type !== 'item_completed') return;
        const item = record(payload.item);
        if (item.type !== 'ContextCompaction') { this.pending = undefined; return; }
        const turn = text(payload.turn_id); const id = text(item.id);
        if (payload.thread_id === this.threadId && turn && id && this.pending?.turn === turn) {
            const key = `${turn}:${id}`;
            // Duplicate/conflicting completed records cannot replace a proven binding.
            const info = !this.pending.ambiguous && Object.keys(this.pending.info).length ? this.pending.info : null;
            this.compactions.set(key, this.compactions.has(key) ? null : info);
        }
        this.pending = undefined;
    }

    private async scan(path: string): Promise<boolean> {
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const stat = await handle.stat();
            // Reuse the existing authenticated history transport's finite bound.
            // Both checkpoint text and first-output timing are optional enrichments.
            if (!stat.isFile() || stat.size > CODEX_WEBSOCKET_MAX_PAYLOAD) { this.reset(); return false; }
            const identity = `${stat.dev}:${stat.ino}`;
            if (path !== this.path || identity !== this.identity || stat.size < this.offset
                || (stat.size === this.offset && stat.mtimeMs !== this.mtime)) this.reset();
            this.path = path; this.identity = identity; this.mtime = stat.mtimeMs;
            const buffer = Buffer.alloc(64 * 1024);
            while (this.offset < stat.size) {
                const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - this.offset), this.offset);
                if (!bytesRead) break;
                this.offset += bytesRead;
                const chunk = Buffer.concat([this.partial, buffer.subarray(0, bytesRead)]);
                let start = 0; let end: number;
                while ((end = chunk.indexOf(10, start)) !== -1) { this.line(chunk.subarray(start, end).toString('utf8')); start = end + 1; }
                this.partial = Buffer.from(chunk.subarray(start));
            }
            return this.first || this.verified;
        } finally { await handle.close(); }
    }

    find(thread: unknown, turnId: string, itemId: string, options?: LookupOptions): Promise<CodexCompactionInfo | null> {
        if (!turnId || !itemId) return Promise.resolve(null);
        return this.lookup(thread, () => this.compactions.get(`${turnId}:${itemId}`), options);
    }

    turnTiming(thread: unknown, turnId: string): Promise<CodexTurnTiming | null> {
        if (!turnId) return Promise.resolve(null);
        return this.lookup(thread, () => this.turnTimings.get(turnId), {
            attempts: 3,
            sleep: () => new Promise(resolve => setTimeout(resolve, 40))
        });
    }

    private lookup<T>(thread: unknown, read: () => T | null | undefined, options?: LookupOptions): Promise<T | null> {
        // Live notifications and history refresh share the incremental offset.
        const result = this.work.catch(() => {}).then(() => this.findNow(thread, read, options));
        this.work = result;
        return result;
    }

    private async findNow<T>(thread: unknown, read: () => T | null | undefined, options?: LookupOptions): Promise<T | null> {
        const source = record(thread); const path = text(source.path);
        if (source.id !== this.threadId || !path || !isAbsolute(path)) return null;
        // The native notification can precede the rollout flush.
        const attempts = options?.attempts ?? 10;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try { if (!await this.scan(path)) return null; }
            catch { this.reset(); return null; }
            const value = read();
            if (value !== undefined) return value;
            if (attempt + 1 < attempts) await (options?.sleep ?? (() => new Promise(resolve => setTimeout(resolve, 500))))();
        }
        return null;
    }
}
