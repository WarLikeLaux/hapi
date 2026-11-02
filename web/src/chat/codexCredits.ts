// Credits per million tokens, Standard Codex rates, checked 2026-11-02:
// https://learn.chatgpt.com/docs/pricing
const CODEX_CREDIT_RATES: Record<string, readonly [number, number, number]> = {
    'gpt-6.1-terra': [25, 1.25, 125],
    'gpt-6.1-sol': [50, 2.5, 250],
    'gpt-6-astra': [250, 25, 1250],
    'gpt-6-sol': [50, 5, 250],
    'gpt-6-luna': [2.5, 0.25, 12.5],
    'gpt-5.6-sol': [100, 10, 500],
    'gpt-5.6-terra': [50, 5, 300],
    'gpt-5.6-luna': [5, 0.5, 30],
}


export function estimateCodexCredits(model: string, tier: string, input: number, cached: number, output: number): number | undefined {
    const rates = CODEX_CREDIT_RATES[model.toLowerCase()]
    const speed = tier.toLowerCase()
    if (!rates || (speed !== 'standard' && speed !== 'fast' && speed !== 'priority')
        || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0
        || !Number.isSafeInteger(cached) || cached < 0 || cached > input) return
    return ((input - cached) * rates[0] + cached * rates[1] + output * rates[2])
        * (speed === 'standard' ? 1 : 2.5) / 1_000_000
}

export function formatCodexCredits(credits: number): string {
    if (credits > 0 && credits < 1) return '1'
    const step = credits < 50 ? 1 : credits < 100 ? 5 : credits < 250 ? 10 : credits < 1000 ? 50 : 100
    return String(Math.round(credits / step) * step)
}
