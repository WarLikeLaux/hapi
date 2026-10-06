import { createHash } from 'node:crypto';
import type { ApiSessionClient } from '@/api/apiSession';
import { normalizeSessionDisplayTitle } from '@/agent/sessionDisplayRename';
import { registerGeneratedImageFromPath } from '@/modules/common/generatedImages';
import { AppServerEventConverter } from '../utils/appServerEventConverter';
import { record, string } from './gateway';
import { codexPlanProposalId } from './plan';
import { asyncQuestionForItem, asyncQuestionAnswerId, asyncQuestionAnswerDisplay, parseAsyncQuestionAnswer } from './asyncQuestions';

export function inputText(input: unknown): string {
    if (!Array.isArray(input)) return '';
    return input.map(part => {
        const value = record(part);
        return string(value.text) ?? (value.type === 'mention' ? `@"${value.path}"` : value.type === 'skill' ? `$${value.name}`
            : value.type === 'localImage' ? `[Image: ${value.path}]` : value.type === 'image' ? '[Image]' : '');
    }).filter(Boolean).join('\n');
}

function requestedTitle(item: Record<string, unknown>): string | undefined {
    if (item.type !== 'mcpToolCall' || item.server !== 'hapi' || item.tool !== 'change_title') return;
    return normalizeSessionDisplayTitle(string(record(item.arguments).title)) ?? undefined;
}

function successfulTitle(item: Record<string, unknown>, pending?: string): string | undefined {
    if (item.type !== 'mcpToolCall' || (item.status !== undefined && item.status !== 'completed')
        || item.error != null || item.result == null) return;
    const result = record(item.result);
    if ('Err' in result || result.isError === true || record(result.Ok).isError === true) return;
    return requestedTitle(item) ?? pending;
}

function metadataHasDisplayTitle(metadata: { name?: string; summary?: { text: string } } | null | undefined): boolean {
    return Boolean(metadata?.name?.trim() || metadata?.summary?.text?.trim());
}

/** Canonical V2 stream only. Stable message IDs also deduplicate snapshot replay at the hub. */
export class SharedCodexProjection {
    private converter = new AppServerEventConverter();
    private readonly emitted = new Set<string>();
    private readonly turns = new Map<string, string>();
    private readonly turnModels = new Map<string, string>();
    // Unlike transcript emission, title side effects survive reset/replay.
    private readonly pendingTitles = new Map<string, string>();
    private readonly completedTitles = new Set<string>();
    private titleRevision = 0;
    private readonly answeredAsyncQuestions = new Map<string, Record<string, { answers: string[] }>>();
    private readonly dismissedAsyncQuestions = new Set<string>();
    private readonly turnOfQuestion = new Map<string, string>();
    /** Questions dropped only because their turn is no longer current. Rebuilt
     *  by every history pre-scan so the replay loop cannot re-add them. */
    private turnStaleAsyncQuestionIds = new Set<string>();
    private pendingAsyncQuestionIds = new Set<string>();
    private asyncQuestionsInitialized = false;
    constructor(private readonly session: ApiSessionClient, readonly threadId: string,
        private readonly committed: (id: string) => Promise<void>, private readonly parentThreadId?: string,
        private readonly acceptedAsyncAnswer: (questionId: string) => Record<string, { answers: string[] }> | undefined = () => undefined) {
        if (!parentThreadId) for (const [id, turn] of Object.entries(session.getMetadata()?.conversationHistoryTurns ?? {})) this.turns.set(id, turn);
    }

    turnFor(id: string): string | undefined { return this.turns.get(id); }
    /** Metadata-dismissals survive relaunch; the in-memory set covers the window
     *  before the metadata write round-trips. */
    private isDismissedAsyncQuestion(questionId: string): boolean {
        return this.dismissedAsyncQuestions.has(questionId)
            || Object.prototype.hasOwnProperty.call(this.session.getMetadata()?.codexDismissedAsyncQuestions ?? {}, questionId);
    }
    /** Operator dismissed the card without answering. Recorded durably by the
     *  caller (metadata) so replay never resurrects the question. */
    dismissAsyncQuestion(questionId: string): void {
        this.dismissedAsyncQuestions.add(questionId);
        this.pendingAsyncQuestionIds.delete(questionId);
        if (!this.parentThreadId) this.session.updateAgentState(state => {
            if (!state.codexAsyncQuestions?.[questionId]) return state;
            const questions = { ...state.codexAsyncQuestions };
            delete questions[questionId];
            return { ...state, codexAsyncQuestions: questions };
        });
    }
    /** A question is only attention-worthy while its turn is the newest one (or
     *  still running). Codex keeps working after an async question; once it
     *  moves on to a later turn the question is stale by construction. */
    private expireAsyncQuestionsBeforeTurn(turnId: string): void {
        const stale = [...this.pendingAsyncQuestionIds].filter(id => this.turnOfQuestion.get(id) !== turnId);
        if (!stale.length) return;
        for (const id of stale) this.pendingAsyncQuestionIds.delete(id);
        this.session.updateAgentState(state => {
            const questions = { ...state.codexAsyncQuestions };
            let changed = false;
            for (const id of stale) {
                if (questions[id] === undefined) continue;
                delete questions[id];
                changed = true;
            }
            return changed ? { ...state, codexAsyncQuestions: questions } : state;
        });
    }
    answerAsyncQuestion(questionId: string, answers: Record<string, { answers: string[] }>): void {
        this.answeredAsyncQuestions.set(questionId, answers);
        this.pendingAsyncQuestionIds.delete(questionId);
        if (!this.parentThreadId) this.session.updateAgentState(state => {
            if (!state.codexAsyncQuestions?.[questionId]) return state;
            const questions = { ...state.codexAsyncQuestions };
            delete questions[questionId];
            return { ...state, codexAsyncQuestions: questions };
        });
        this.send({ type: 'tool-call-result', callId: questionId, output: { answers } }, `async-answer:${questionId}`);
    }
    reset(): void { this.converter = new AppServerEventConverter(); this.emitted.clear(); }
    private send(body: Record<string, unknown>, key: string, publish = true): void {
        if (this.emitted.has(key)) return;
        this.emitted.add(key);
        if (!publish) return;
        const id = `codex:${this.threadId}:${key}`;
        this.session.sendAgentMessage(this.parentThreadId && !String(body.type).startsWith('agent-run-') ? {
            type: 'agent-run-trace', agentId: this.threadId, cardId: `codex-agent:${this.threadId}`, message: { ...body, id }, id,
            scope: { role: 'child', threadId: this.threadId, parentThreadId: this.parentThreadId }, scope_role: 'child'
        } : { ...body, id }, id);
    }

    private applyDisplayRename(title: string, revision: number): void {
        this.session.updateMetadata(metadata => {
            if (revision !== this.titleRevision) return metadata;
            const normalized = normalizeSessionDisplayTitle(title);
            if (!normalized || metadata.name?.trim() === normalized) return metadata;
            return { ...metadata, name: normalized };
        });
    }

    async notification(method: string, params: unknown, modelAtReceipt?: string): Promise<void> {
        const p = record(params);
        const item = record(p.item);
        if (!this.parentThreadId && p.threadId === this.threadId && string(item.id)) {
            const key = `${string(p.turnId) ?? 'thread'}:${item.id}`;
            if (!this.completedTitles.has(key)) {
                const title = requestedTitle(item);
                if (method === 'item/started' && title) this.pendingTitles.set(key, title);
                if (method === 'item/completed') {
                    const completedTitle = successfulTitle(item, this.pendingTitles.get(key));
                    this.pendingTitles.delete(key);
                    if (completedTitle) {
                        this.completedTitles.add(key);
                        const revision = ++this.titleRevision;
                        this.applyDisplayRename(completedTitle, revision);
                    }
                }
            }
        }
        await this.project(method, params, modelAtReceipt);
    }

    private async project(method: string, params: unknown, modelAtReceipt?: string, publish = true): Promise<void> {
        if (method.startsWith('codex/event/')) return;
        const p = record(params);
        const item = record(p.item);
        const turnId = string(p.turnId) ?? string(record(p.turn).id);
        // Settings may already describe the next turn by the time queued
        // notifications are projected. Never attribute usage to that model.
        if (turnId && method === 'turn/started' && modelAtReceipt && !this.turnModels.has(turnId)) {
            this.turnModels.set(turnId, modelAtReceipt);
        }
        if (turnId && method === 'model/rerouted' && string(p.toModel)) {
            this.turnModels.set(turnId, string(p.toModel)!);
        }
        const itemId = string(item.id) ?? string(p.itemId);
        if (!this.parentThreadId && (method === 'item/started' || method === 'item/completed') && item.type === 'userMessage') {
            const id = string(item.clientId ?? item.clientUserMessageId) ?? (itemId ? `codex:${this.threadId}:user:${itemId}` : undefined);
            if (id) {
                const firstInTurn = turnId ? [...this.turns].find(([, value]) => value === turnId)?.[0] : undefined;
                if (turnId) this.turns.set(id, turnId);
                if (publish) await this.committed(id);
                const text = inputText(item.content);
                const answer = parseAsyncQuestionAnswer(text);
                if (answer && id === asyncQuestionAnswerId(answer.questionId) && publish) {
                    this.answerAsyncQuestion(answer.questionId, answer.answers);
                }
                if (publish) {
                    if (text) this.session.sendUserMessage(answer ? asyncQuestionAnswerDisplay(text) : text, undefined, id);
                    this.session.updateMetadata(metadata => ({ ...metadata, conversationHistoryTurns: Object.fromEntries(this.turns),
                        ...(turnId && (!firstInTurn || firstInTurn === id) ? { conversationHistoryPoints: { ...metadata.conversationHistoryPoints, [id]: true } } : {})
                    }));
                }
            }
        }
        if (this.parentThreadId && (method === 'turn/started' || method === 'turn/completed')) {
            this.send({ type: 'agent-run-update', agentId: this.threadId, cardId: `codex-agent:${this.threadId}`,
                status: method === 'turn/started' ? 'running' : record(p.turn).status === 'completed' ? 'completed' : 'failed'
            }, `lifecycle:${turnId}:${method}`, publish);
        }
        if (!this.parentThreadId && method === 'turn/started' && turnId && (string(p.threadId) ?? this.threadId) === this.threadId) {
            this.expireAsyncQuestionsBeforeTurn(turnId);
        }
        const question = method === 'item/completed' ? asyncQuestionForItem(this.threadId, item) : undefined;
        if (question) {
            if (turnId) this.turnOfQuestion.set(question.id, turnId);
            if (!this.parentThreadId && !this.pendingAsyncQuestionIds.has(question.id)
                && !this.answeredAsyncQuestions.has(question.id) && !this.acceptedAsyncAnswer(question.id)
                && !this.isDismissedAsyncQuestion(question.id) && !this.turnStaleAsyncQuestionIds.has(question.id)) {
                this.pendingAsyncQuestionIds.add(question.id);
                this.session.updateAgentState(state => state.codexAsyncQuestions?.[question.id] ? state : ({ ...state,
                    codexAsyncQuestions: { ...state.codexAsyncQuestions, [question.id]: {
                        tool: 'request_user_input_async', toolCallId: question.id,
                        arguments: { questions: question.questions }, createdAt: Date.now()
                    } }
                }));
            }
            const key = `${turnId ?? 'thread'}:${itemId}:async-question`;
            this.send({ type: 'tool-call', name: 'request_user_input_async', callId: question.id,
                input: { questions: question.questions, readOnly: Boolean(this.parentThreadId) } }, key, publish);
            const answers = this.answeredAsyncQuestions.get(question.id) ?? this.acceptedAsyncAnswer(question.id);
            this.send({ type: 'tool-call-result', callId: question.id, output: answers ? { answers } : null }, `${key}:result`, publish);
            return;
        }
        const events = this.converter.handleNotification(method, params);
        for (const event of events) {
            const callId = string(event.call_id);
            const key = `${turnId ?? 'thread'}:${itemId ?? callId ?? createHash('sha256').update(JSON.stringify(event)).digest('hex')}:${event.type}`;
            if (event.type === 'agent_message') this.send({ type: 'message', message: event.message }, key, publish);
            else if (event.type === 'agent_reasoning') this.send({ type: 'reasoning', message: event.text }, key, publish);
            else if (event.type === 'exec_command_begin' && callId) {
                this.send({ type: 'tool-call', name: 'CodexBash', callId, input: event }, key, publish);
            } else if (event.type === 'exec_command_end' && callId) {
                this.send({ type: 'tool-call-result', callId, output: { ...event, stdout: event.output } }, key, publish);
            } else if (event.type === 'patch_apply_begin' && callId) {
                this.send({ type: 'tool-call', name: 'CodexPatch', callId, input: { changes: event.changes, auto_approved: event.auto_approved } }, key, publish);
            } else if (event.type === 'patch_apply_end' && callId) {
                this.send({ type: 'tool-call-result', callId, output: { stdout: event.stdout, stderr: event.stderr, success: event.success } }, key, publish);
            } else if (event.type === 'mcp_tool_call_begin' && callId) {
                const invocation = record(event.invocation);
                this.send({ type: 'tool-call', name: `mcp__${invocation.server}__${invocation.tool}`, callId, input: invocation.arguments ?? {} }, key, publish);
            } else if (event.type === 'mcp_tool_call_end' && callId) {
                const result = record(event.result);
                this.send({ type: 'tool-call-result', callId, output: result.Ok ?? result.Err ?? event.result, is_error: 'Err' in result }, key, publish);
            } else if (event.type === 'codex_tool_call_begin' && callId) {
                this.send({ type: 'tool-call', name: event.name, callId, input: event.input ?? event.arguments }, key, publish);
            } else if (event.type === 'codex_tool_call_end' && callId) {
                this.send({ type: 'tool-call-result', callId, output: event.output, is_error: event.is_error }, key, publish);
            } else if (event.type === 'token_count' || event.type === 'context_compacted' || event.type.startsWith('thread_goal_')) {
                const model = event.type === 'token_count' && turnId ? this.turnModels.get(turnId) : undefined;
                this.send({ ...event, ...(model ? { model } : {}), flavor: 'codex', scope: { role: 'parent', threadId: this.threadId }, scope_role: 'parent', thread_id: this.threadId }, key, publish);
            } else if (event.type === 'proposed_plan' && turnId && itemId) {
                const planId = codexPlanProposalId(this.threadId, turnId, itemId);
                this.send({ type: 'tool-call', name: 'ExitPlanMode', callId: planId, input: { plan: event.plan } }, key, publish);
                // A proposal is durable content, not a native approval request.
                this.send({ type: 'tool-call-result', callId: planId, output: null }, `${key}:result`, publish);
            } else if (event.type === 'plan_update') {
                this.send({ type: 'tool-call', name: 'update_plan', callId: 'codex-plan-state', input: { plan: event.plan, source: 'codex' } }, key, publish);
                this.send({ type: 'tool-call-result', callId: 'codex-plan-state', output: { plan: event.plan, source: 'codex', status: 'updated' } }, `${key}:result`, publish);
            } else if (event.type === 'generated_image' && typeof event.saved_path === 'string') {
                if (!publish) this.emitted.add(key);
                else {
                    const image = await registerGeneratedImageFromPath({ path: event.saved_path, id: createHash('sha256').update(`${this.threadId}:${key}`).digest('hex'), fileName: string(event.file_name) });
                    if (image) this.send({ type: 'generated-image', imageId: image.id, fileName: image.fileName, mimeType: image.mimeType }, key);
                }
            } else if (event.type === 'task_failed') {
                this.send({ type: 'message', message: `Codex error: ${event.error ?? event.message ?? 'Turn failed'}` }, key, publish);
            }
        }
        if (item.type === 'collabAgentToolCall') {
            const states = record(item.agentsStates);
            for (const [agentId, state] of Object.entries(states)) {
                const status = string(record(state).status) ?? 'running';
                this.send({ type: 'agent-run-update', agentId, cardId: `codex-agent:${agentId}`,
                    status: status === 'completed' ? 'completed' : status === 'errored' ? 'failed' : 'running',
                    summary: record(state).message, input: item, scope: { role: 'child', threadId: agentId, parentThreadId: this.threadId }, scope_role: 'child', thread_id: agentId
                }, `agent:${agentId}:${itemId}:${method}:${JSON.stringify(state)}`, publish);
            }
        }
    }

    async history(thread: unknown, publish = true): Promise<void> {
        const turns = record(thread).turns;
        if (!Array.isArray(turns)) return;
        if (!this.parentThreadId) {
            const questionIds = new Set<string>();
            const questionTurns = new Map<string, { turnId: string; status: string }>();
            for (const value of turns) {
                const turn = record(value);
                const turnId = string(turn.id);
                for (const item of Array.isArray(turn.items) ? turn.items as unknown[] : []) {
                    const question = asyncQuestionForItem(this.threadId, item);
                    if (question) {
                        questionIds.add(question.id);
                        if (turnId) {
                            questionTurns.set(question.id, { turnId, status: string(turn.status) ?? 'unknown' });
                            this.turnOfQuestion.set(question.id, turnId);
                        }
                    }
                    const receipt = record(item);
                    if (receipt.type !== 'userMessage') continue;
                    const answer = parseAsyncQuestionAnswer(inputText(receipt.content));
                    if (answer && (receipt.clientId ?? receipt.clientUserMessageId) === asyncQuestionAnswerId(answer.questionId)) {
                        this.answeredAsyncQuestions.set(answer.questionId, answer.answers);
                    }
                }
            }
            // Only the newest turn's questions (or a still-running turn's) stay
            // pending after a replay; earlier ones were passed over by the agent.
            const latestTurnId = string(record(turns.at(-1) ?? {}).id);
            const pendingIds = new Set([...questionIds].filter(id => {
                if (this.answeredAsyncQuestions.has(id) || this.acceptedAsyncAnswer(id) || this.isDismissedAsyncQuestion(id)) return false;
                const turn = questionTurns.get(id);
                if (!turn) return true;
                return turn.turnId === latestTurnId || turn.status === 'inProgress';
            }));
            this.turnStaleAsyncQuestionIds = new Set([...questionIds].filter(id =>
                !pendingIds.has(id) && !this.answeredAsyncQuestions.has(id)
                && !this.acceptedAsyncAnswer(id) && !this.isDismissedAsyncQuestion(id)));
            const changed = !this.asyncQuestionsInitialized || [...this.pendingAsyncQuestionIds].some(id => !pendingIds.has(id));
            this.asyncQuestionsInitialized = true;
            this.pendingAsyncQuestionIds = new Set([...this.pendingAsyncQuestionIds].filter(id => pendingIds.has(id)));
            if (changed) this.session.updateAgentState(state => {
                const pending = Object.entries(state.codexAsyncQuestions ?? {}).filter(([id]) =>
                    pendingIds.has(id));
                if (pending.length === Object.keys(state.codexAsyncQuestions ?? {}).length) return state;
                return { ...state, codexAsyncQuestions: Object.fromEntries(pending) };
            });
        }
        const titleRevision = this.titleRevision;
        let latestTitle: string | undefined;
        for (const value of turns) {
            const turn = record(value);
            if (!Array.isArray(turn.items)) continue;
            for (const item of turn.items) {
                const params = { threadId: this.threadId, turnId: turn.id, item };
                const titleKey = `${string(turn.id) ?? 'thread'}:${record(item).id}`;
                const pendingTitle = requestedTitle(record(item));
                if (!this.parentThreadId && string(record(item).id) && pendingTitle && !this.completedTitles.has(titleKey)) {
                    this.pendingTitles.set(titleKey, pendingTitle);
                }
                await this.project('item/started', params, undefined, publish);
                // Active snapshots can contain partial assistant text. Do not
                // settle it under the final stable id and suppress completion.
                if (turn.status !== 'inProgress' || record(item).status === 'completed' || record(item).type === 'userMessage'
                    || asyncQuestionForItem(this.threadId, item)) {
                    if (!this.parentThreadId) {
                        const title = successfulTitle(record(item));
                        if (title && string(record(item).id)) {
                            latestTitle = title;
                            this.completedTitles.add(titleKey);
                        }
                        this.pendingTitles.delete(titleKey);
                    }
                    await this.project('item/completed', params, undefined, publish);
                }
            }
        }
        // Repair sessions created while remote title projection was missing.
        // Recheck inside the metadata lock: live updates may still be queued,
        // and a replay must never replace an existing or newer display title.
        if (latestTitle && titleRevision === this.titleRevision && !metadataHasDisplayTitle(this.session.getMetadata())) {
            const title = latestTitle;
            this.session.updateMetadata(metadata => {
                if (titleRevision !== this.titleRevision || metadataHasDisplayTitle(metadata)) {
                    return metadata;
                }
                const normalized = normalizeSessionDisplayTitle(title);
                if (!normalized) return metadata;
                return { ...metadata, name: normalized };
            });
        }
    }
}
