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

const GPT_62_RATES: Record<string, readonly [number, number, number]> = {
    'gpt-6.2-astra': [200, 10, 1_000],
    'gpt-6.2-sol': [50, 2.5, 250]
}

function calculateCredits(
    rates: readonly [number, number, number] | undefined,
    multiplier: number,
    input: number,
    cached: number,
    output: number
): number | undefined {
    if (!rates || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0
        || !Number.isSafeInteger(cached) || cached < 0 || cached > input) return
    return ((input - cached) * rates[0] + cached * rates[1] + output * rates[2]) * multiplier / 1_000_000
}

/** Estimate at regular purchased-credit rates. Per-turn eligibility for promotions is unavailable. */
export function estimateCodexPurchasedCredits(
    model: string, tier: string, input: number, cached: number, output: number
): number | undefined {
    const slug = model.toLowerCase()
    const speed = tier.toLowerCase()
    const gpt62 = GPT_62_RATES[slug]
    const rates = gpt62 ?? CODEX_CREDIT_RATES[slug]
    if (speed === 'standard') return calculateCredits(rates, 1, input, cached, output)
    if (speed === 'fast' || speed === 'priority') {
        if (slug.startsWith('gpt-5.6')) return
        return calculateCredits(rates, 2, input, cached, output)
    }
    if (speed === 'ultrafast') {
        if (gpt62 || slug === 'gpt-6-astra' || slug === 'gpt-6.1-sol') {
            return calculateCredits(rates, 6, input, cached, output)
        }
    }
    return undefined
}

export function formatCodexCredits(credits: number): string {
    const scaled = credits * 100
    if (scaled > 0 && scaled < 1) return '1'
    const step = scaled < 50 ? 1 : scaled < 100 ? 5 : scaled < 250 ? 10 : scaled < 1000 ? 50 : 100
    return String(Math.round(scaled / step) * step)
}
