import axios, { type AxiosInstance } from 'axios'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'

export type DifitReviewAttachment = {
    sessionId: string
    reviewId: string
    url?: string
    reviewUrl?: string
    branch?: string
}

export type UpdateDifitReviewAttachmentOptions = {
    action: 'attach' | 'detach'
    attachment: DifitReviewAttachment
    http?: AxiosInstance
}

function requestHeaders(jwt: string): Record<string, string> {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
    })
}

async function exchangeJwt(http: AxiosInstance): Promise<string> {
    const apiUrl = configuration.apiUrl.trim().replace(/\/+$/, '')
    const response = await http.post(
        `${apiUrl}/api/auth`,
        { accessToken: getAuthToken() },
        {
            headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
            timeout: 10_000,
            validateStatus: () => true
        }
    )
    const jwt = typeof response.data?.token === 'string' ? response.data.token : ''
    if (response.status < 200 || response.status >= 300 || !jwt) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new Error(`Failed to authenticate with HAPI hub: ${detail}`)
    }
    return jwt
}

export async function updateDifitReviewAttachment(
    options: UpdateDifitReviewAttachmentOptions
): Promise<void> {
    const http = options.http ?? axios
    const apiUrl = configuration.apiUrl.trim().replace(/\/+$/, '')
    const jwt = await exchangeJwt(http)
    const { action, attachment } = options
    const response = await http.request({
        method: action === 'attach' ? 'PUT' : 'DELETE',
        url: `${apiUrl}/api/sessions/${encodeURIComponent(attachment.sessionId)}/difit-review`,
        headers: requestHeaders(jwt),
        data: action === 'attach'
            ? {
                reviewId: attachment.reviewId,
                url: attachment.url,
                ...(attachment.reviewUrl ? { reviewUrl: attachment.reviewUrl } : {}),
                ...(attachment.branch ? { branch: attachment.branch } : {})
            }
            : { reviewId: attachment.reviewId },
        timeout: 10_000,
        validateStatus: () => true
    })
    if (response.status < 200 || response.status >= 300 || response.data?.ok !== true) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new Error(`Failed to ${action} DIFIT review: ${detail}`)
    }
}
