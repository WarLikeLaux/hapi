import { describe, expect, it, vi } from 'vitest';
import { NativeCodexRecaps } from './recaps';

function fixture() {
    const publish = vi.fn();
    const recaps = new NativeCodexRecaps(id => id === 'root' ? { publish } : undefined);
    recaps.after({ id: 1, method: 'thread/resume', params: { threadId: 'root' } }, { id: 1, result: { thread: { id: 'root' } } }, 'owner');
    const start = { id: 2, method: 'thread/start', params: { ephemeral: true } };
    recaps.before(start, 'owner');
    recaps.after(start, { id: 2, result: { thread: { id: 'temporary' } } }, 'owner');
    const turn = (text = 'Write a brief catch-up for a user returning to this task.') => recaps.before({ id: 3, method: 'turn/start',
        params: { threadId: 'temporary', input: [{ type: 'text', text }], outputSchema: { type: 'object',
            properties: { summary: { type: 'string' }, next_action: { type: ['string', 'null'] } }, required: ['summary', 'next_action'] } } }, 'owner');
    const complete = (text: string, connection = 'owner', status = 'completed') => {
        recaps.observe({ method: 'turn/started', params: { threadId: 'temporary', turn: { id: 'turn' } } }, connection);
        recaps.observe({ method: 'item/completed', params: { threadId: 'temporary', turnId: 'turn', item: { type: 'agentMessage', text } } }, connection);
        recaps.observe({ method: 'turn/completed', params: { threadId: 'temporary', turn: { id: 'turn', status } } }, connection);
    };
    return { recaps, publish, turn, complete };
}

describe('native Codex recap boundaries', () => {
    it('ignores another connection and delivers the owning connection only once', () => {
        const f = fixture(); f.turn();
        const text = JSON.stringify({ summary: ' Finished the task. ', next_action: '' });
        f.complete(text, 'other'); expect(f.publish).not.toHaveBeenCalled();
        f.complete(text); f.complete(text);
        expect(f.publish).toHaveBeenCalledExactlyOnceWith('Finished the task.', 'codex-recap:temporary:turn');
    });

    it.each(['prediction', 'disconnected', 'failed', 'invalid', 'extra-fields'])('does not publish %s temporary output', cause => {
        const f = fixture(); f.turn(cause === 'prediction' ? 'Predict the next user input.' : undefined);
        if (cause === 'disconnected') f.recaps.disconnected('owner');
        f.complete(cause === 'invalid' ? '{"summary":"too incomplete"}' : cause === 'extra-fields'
            ? '{"summary":"Finished the task.","next_action":null,"unexpected":true}' : '{"summary":"Finished the task.","next_action":null}',
            'owner', cause === 'failed' ? 'failed' : 'completed');
        expect(f.publish).not.toHaveBeenCalled();
    });

    it('clears the displayed root when the terminal resumes an unbound thread', () => {
        const f = fixture();
        f.recaps.after({ id: 4, method: 'thread/resume' }, { id: 4, result: { thread: { id: 'unbound' } } }, 'owner');
        const start = { id: 5, method: 'thread/start', params: { ephemeral: true } };
        f.recaps.before(start, 'owner');
        f.recaps.after(start, { id: 5, result: { thread: { id: 'unbound-temporary' } } }, 'owner');
        f.recaps.before({ id: 6, method: 'turn/start', params: { threadId: 'unbound-temporary',
            input: [{ type: 'text', text: 'Write a brief catch-up for a user returning to this task.' }],
            outputSchema: { type: 'object', properties: { summary: { type: 'string' }, next_action: { type: ['string', 'null'] } }, required: ['summary', 'next_action'] } } }, 'owner');
        f.recaps.observe({ method: 'turn/started', params: { threadId: 'unbound-temporary', turn: { id: 'turn' } } }, 'owner');
        f.recaps.observe({ method: 'item/completed', params: { threadId: 'unbound-temporary', turnId: 'turn',
            item: { type: 'agentMessage', text: '{"summary":"A different task.","next_action":null}' } } }, 'owner');
        f.recaps.observe({ method: 'turn/completed', params: { threadId: 'unbound-temporary', turn: { id: 'turn', status: 'completed' } } }, 'owner');
        expect(f.publish).not.toHaveBeenCalled();
    });
});
