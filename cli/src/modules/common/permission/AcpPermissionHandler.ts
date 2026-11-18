import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentBackend, AgentMessage, FormElicitationResponse, PermissionRequest, PermissionResponse } from '@/agent/types'
import { randomUUID } from 'node:crypto'
import { parseAcpFormElicitation, type FormAnswers } from './acpFormElicitation'
import type { PermissionMode } from '@hapi/protocol/types'
import { deriveToolInput, deriveToolName } from '@/agent/utils'
import { logger } from '@/ui/logger'
import {
    BasePermissionHandler,
    type AutoApprovalDecision,
    type AutoApprovalRuleSet,
    type PendingPermissionRequest,
    type PermissionCompletion
} from './BasePermissionHandler'

interface PermissionResponseMessage {
    id: string
    approved: boolean
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    reason?: string
    answers?: FormAnswers
}

export type UserAnswer = {
    decision: NonNullable<PermissionResponseMessage['decision']>
    answers?: Record<string, string[]>
}

function pickOptionId(request: PermissionRequest, preferredKinds: string[]): string | null {
    for (const kind of preferredKinds) {
        const match = request.options.find((option) => option.kind === kind)
        if (match) return match.optionId
    }
    return request.options[0]?.optionId ?? null
}

function mapDecisionToOutcome(
    request: PermissionRequest,
    decision: PermissionResponseMessage['decision']
): PermissionResponse {
    if (decision === 'abort') return { outcome: 'cancelled' }
    if (decision === 'approved_for_session') {
        const optionId = pickOptionId(request, ['allow_always', 'allow_once'])
        return optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
    }
    if (decision === 'approved') {
        const optionId = pickOptionId(request, ['allow_once', 'allow_always'])
        return optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
    }
    const optionId = pickOptionId(request, ['reject_once', 'reject_always'])
    return optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
}

/** Shared HAPI permission bridge for ACP agents with one-shot choices. */
export class AcpPermissionHandler extends BasePermissionHandler<PermissionResponseMessage, void> {
    private readonly pendingBackendRequests = new Map<string, PermissionRequest>()
    private readonly pendingForms = new Map<string, {
        form: NonNullable<ReturnType<typeof parseAcpFormElicitation>>
        resolve: (response: FormElicitationResponse) => void
    }>()
    private readonly userWaitEnds = new Map<string, () => void>()
    private readonly userQuestions = new Map<string, (answer: UserAnswer) => void>()
    // Clients hide a pending request whose id was already completed.
    private readonly usedIds = new Set<string>()

    constructor(
        session: ApiSessionClient,
        private readonly backend: AgentBackend,
        private readonly getPermissionMode: () => PermissionMode | undefined,
        private readonly options: {
            onMessage?: (message: AgentMessage) => void
            // Agents that title requests with free text (agy: the command
            // line) turn off the HAPI tool-name hints, which could match it.
            autoApprovalRules?: AutoApprovalRuleSet
            // A long-lived agent process outlives mode switches, so automatic
            // approvals must not leave standing grants behind.
            autoApproveOnce?: boolean
            // Questions need the user's answer in every mode.
            requiresUser?: (request: PermissionRequest) => boolean
            // Called when a request starts waiting for the user; the returned
            // callback runs once it is answered (agents timing their own work).
            onUserWait?: () => () => void
            // Called synchronously when a permission 'abort' decision cancels
            // the prompt through the backend directly (never via the
            // launcher's abort handler). Flavors that track cancels — e.g.
            // dsh's implicit session-end detection on custom wrappers that
            // close the session on session/cancel — use this to arm their
            // detector for that cancel.
            onCancelIssued?: () => void
        } = {}
    ) {
        super(session)
        this.backend.onPermissionRequest((request) => this.handlePermissionRequest(request))
        this.backend.onFormElicitation?.((params) => this.options.onMessage
            ? this.handleFormElicitation({ ...params, mode: 'form' })
            : Promise.resolve({ action: 'cancel' }))
    }

    private async handleFormElicitation(params: unknown): Promise<FormElicitationResponse> {
        const form = parseAcpFormElicitation(params)
        if (!form) return { action: 'cancel' }
        const id = `acp-elicitation-${randomUUID()}`
        return await new Promise<FormElicitationResponse>((resolve) => {
            this.pendingForms.set(id, { form, resolve })
            // Questions need actual input even when the session auto-approves tools.
            this.options.onMessage?.({ type: 'tool_call', id, name: 'request_user_input', input: form.input, status: 'pending' })
            this.addPendingRequest(id, 'request_user_input', form.input, {
                resolve: () => {},
                reject: (error) => {
                    this.pendingForms.delete(id)
                    resolve({ action: 'cancel' })
                    this.options.onMessage?.({ type: 'tool_result', id, output: { action: 'cancel', reason: error.message }, status: 'failed' })
                }
            })
        })
    }

    private handlePermissionRequest(request: PermissionRequest): void {
        const toolName = deriveToolName({
            title: request.title,
            kind: request.kind,
            rawInput: request.rawInput
        })
        const toolInput = deriveToolInput(request)
        const autoDecision = this.options.requiresUser?.(request)
            ? null
            : this.resolveAutoApprovalDecision(
                this.getPermissionMode(),
                toolName,
                request.toolCallId,
                this.options.autoApprovalRules
            )
        if (autoDecision) {
            const decision = this.options.autoApproveOnce && autoDecision === 'approved_for_session'
                ? 'approved'
                : autoDecision
            void this.autoApprove(request, toolName, toolInput, decision)
            return
        }

        this.pendingBackendRequests.set(request.id, request)
        this.usedIds.add(request.id)
        this.startUserWait(request.id)
        this.addPendingRequest(request.id, toolName, toolInput, {
            resolve: () => {},
            reject: () => {}
        }, request.toolCallId)
        logger.debug(`[ACP] Permission request queued for ${toolName} (${request.id})`)
    }

    private async autoApprove(
        request: PermissionRequest,
        toolName: string,
        toolInput: unknown,
        decision: AutoApprovalDecision
    ): Promise<void> {
        await this.backend.respondToPermission(request.sessionId, request, mapDecisionToOutcome(request, decision))
        const timestamp = Date.now()
        this.client.updateAgentState((currentState) => ({
            ...currentState,
            completedRequests: {
                ...currentState.completedRequests,
                [request.id]: {
                    tool: toolName,
                    arguments: toolInput,
                    createdAt: timestamp,
                    completedAt: timestamp,
                    status: 'approved',
                    decision
                }
            }
        }))
    }

    /**
     * A question the agent asks the user, shown as `toolName` with `input`.
     * Never answered automatically, whatever the permission mode.
     */
    askUser(id: string, toolName: string, input: unknown): Promise<UserAnswer> {
        return new Promise((resolve) => {
            this.userQuestions.set(id, resolve)
            this.usedIds.add(id)
            this.startUserWait(id)
            this.addPendingRequest(id, toolName, input, { resolve: () => {}, reject: () => {} })
        })
    }

    protected async handlePermissionResponse(
        response: PermissionResponseMessage,
        pending: PendingPermissionRequest<void>
    ): Promise<PermissionCompletion> {
        const formRequest = this.pendingForms.get(response.id)
        if (formRequest) {
            this.pendingForms.delete(response.id)
            const decision = response.decision ?? (response.approved ? 'approved' : 'denied')
            const content = response.approved && decision !== 'denied' && decision !== 'abort'
                ? formRequest.form.readAnswers(response.answers)
                : null
            const result: FormElicitationResponse = content !== null
                ? { action: 'accept', content }
                : { action: decision === 'denied' ? 'decline' : 'cancel' }
            formRequest.resolve(result)
            this.options.onMessage?.({
                type: 'tool_result', id: response.id,
                output: result.action === 'accept' ? { answers: response.answers } : result,
                status: result.action === 'accept' ? 'completed' : 'failed'
            })
            return {
                status: result.action === 'accept' ? 'approved' : result.action === 'decline' ? 'denied' : 'canceled',
                decision: result.action === 'accept' ? 'approved' : result.action === 'decline' ? 'denied' : 'abort',
                answers: result.action === 'accept' ? response.answers : undefined,
                reason: response.reason
            }
        }

        const question = this.userQuestions.get(response.id)
        if (question) {
            this.userQuestions.delete(response.id)
            const decision = response.decision ?? (response.approved ? 'approved' : 'denied')
            this.endUserWait(response.id)
            const answers = response.answers && Object.fromEntries(
                Object.entries(response.answers).map(([key, value]) => [key, value.answers])
            )
            question(answers ? { decision, answers } : { decision })
            pending.resolve()
            return {
                status: response.approved ? 'approved' : 'denied',
                decision,
                reason: response.reason,
                answers: response.answers
            }
        }
        const request = this.pendingBackendRequests.get(response.id)
        this.pendingBackendRequests.delete(response.id)
        const decision = response.decision ?? (response.approved ? 'approved' : 'denied')

        if (decision === 'abort' && request) {
            this.options.onCancelIssued?.()
            await this.backend.cancelPrompt(request.sessionId)
        }
        if (request) {
            await this.backend.respondToPermission(request.sessionId, request, mapDecisionToOutcome(request, decision))
        }
        this.endUserWait(response.id)
        pending.resolve()

        return {
            status: response.approved ? 'approved' : 'denied',
            decision,
            reason: response.reason
        }
    }

    protected handleMissingPendingResponse(response: PermissionResponseMessage): void {
        logger.debug('[ACP] Permission response received for unknown request', response.id)
    }

    private startUserWait(id: string): void {
        const end = this.options.onUserWait?.()
        if (end) this.userWaitEnds.set(id, end)
    }

    private endUserWait(id: string): void {
        const end = this.userWaitEnds.get(id)
        this.userWaitEnds.delete(id)
        end?.()
    }

    /** Whether a request with this id is open or was already shown. */
    isUsed(id: string): boolean {
        return this.usedIds.has(id) || this.pendingRequests.has(id)
    }

    hasPendingRequests(): boolean {
        return this.pendingBackendRequests.size > 0 || this.userQuestions.size > 0
    }

    async cancelAll(reason: string): Promise<void> {
        // Questions first: answering them cannot fail, while a permission
        // reply can throw once the agent process is gone.
        const questions = Array.from(this.userQuestions.entries())
        this.userQuestions.clear()
        for (const [id, answer] of questions) {
            this.endUserWait(id)
            answer({ decision: 'abort' })
        }
        const pending = Array.from(this.pendingBackendRequests.values())
        this.pendingBackendRequests.clear()
        for (const request of pending) {
            await this.backend.respondToPermission(request.sessionId, request, { outcome: 'cancelled' })
            this.endUserWait(request.id)
        }
        this.cancelPendingRequests({
            completedReason: reason,
            rejectMessage: reason,
            decision: 'abort'
        })
    }
}
