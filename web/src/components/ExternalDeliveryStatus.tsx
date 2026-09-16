import type { ExternalMessageDeliveryStatus } from '@hapi/protocol/messengers'
import { cn } from '@/lib/utils'

export function ExternalDeliveryStatus(props: {
    status: ExternalMessageDeliveryStatus
    className?: string
}) {
    const read = props.status === 'read'
    const label = read ? 'Read' : 'Sent'
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            className={cn('inline-flex shrink-0 text-[var(--app-hint)]', read && 'text-[#2AABEE]', props.className)}
        >
            <svg
                viewBox="0 0 18 12"
                aria-hidden="true"
                className="h-2.5 w-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
            >
                <path d={read ? 'm1 6.5 3 3 6-7' : 'm4 6.5 3 3 6-7'} />
                {read ? <path d="m7 7.5 2 2 8-8" /> : null}
            </svg>
        </span>
    )
}
