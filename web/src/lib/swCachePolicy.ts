/** Never cache an SSO login page or redirect in place of a syntax module. */
export const cacheJavaScriptOnly = {
    cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> =>
        response.status === 200 && !response.redirected
        && /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(response.headers.get('content-type') ?? '')
            ? response : null,
}
