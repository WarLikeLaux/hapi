import type { ReactNode } from 'react'

type IconProps = {
    className?: string
}

function createIcon(paths: ReactNode, props: IconProps, strokeWidth = 1.5) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths}
        </svg>
    )
}

export function CloseIcon(props: IconProps) {
    return createIcon(
        <path d="M6 18 18 6M6 6l12 12" />,
        props,
        2
    )
}

/** GitLab tanuki silhouette in the theme color — external review (PR) button mark. */
export function GitLabIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 32 32"
            fill="currentColor"
        >
            <path d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z" />
            <path d="m31.46 12.78-.04-.12a14.75 14.75 0 0 0-5.86 2.64l-9.55 7.24 6.09 4.6 6.67-5h.02a8.09 8.09 0 0 0 2.67-9.36Z" opacity=".65" />
            <path d="M6.44 15.3a14.71 14.71 0 0 0-5.86-2.63l-.05.12a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 6.1-4.6-9.56-7.24Z" opacity=".65" />
        </svg>
    )
}
/** VS Code ribbon (vscode-codicons outline) — "open in Code" button mark. */
export function CodeIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 16 16"
            fill="currentColor"
        >
            <path d="M15.434 1.72887L12.14 0.144875C12.002 0.078875 11.855 0.046875 11.709 0.046875C11.353 0.046875 11.18 0.211875 11.155 0.228875C11.073 0.270875 11.005 0.337875 11.004 0.338875L4.698 6.08888L1.951 4.00488C1.832 3.91388 1.69 3.86987 1.548 3.86987C1.387 3.86987 1.226 3.92788 1.1 4.04288L0.219 4.84387C0.074 4.97587 0.001 5.15688 0.001 5.33687C0.001 5.51687 0.073 5.69688 0.218 5.82888L2.6 8.00088L0.217 10.1719C0.072 10.3039 0 10.4839 0 10.6639C0 10.8439 0.073 11.0249 0.218 11.1569L1.099 11.9579C1.226 12.0729 1.386 12.1309 1.547 12.1309C1.688 12.1309 1.83 12.0859 1.95 11.9959L4.697 9.91187L11.003 15.6619C11.003 15.6619 11.072 15.7299 11.155 15.7719C11.179 15.7889 11.353 15.9529 11.709 15.9529C11.855 15.9529 12.003 15.9209 12.141 15.8549L15.435 14.2709C15.781 14.1049 16.001 13.7539 16.001 13.3699V2.62888C16.001 2.24487 15.781 1.89488 15.435 1.72787L15.434 1.72887ZM7.217 7.99988L12.002 4.36987V11.6299L7.217 7.99988Z" />
        </svg>
    )
}

export function ShareIcon(props: IconProps) {
    return createIcon(
        <path d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />,
        props
    )
}

export function PlusCircleIcon(props: IconProps) {
    return createIcon(
        <path d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
        props
    )
}

export function CopyIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>,
        props,
        2
    )
}

export function CheckIcon(props: IconProps) {
    return createIcon(
        <polyline points="20 6 9 17 4 12" />,
        props,
        2
    )
}

export function MarkAllReadIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="m3 5 2 2 4-4" />
            <path d="M13 5h8" />
            <path d="m3 12 2 2 4-4" />
            <path d="M13 12h8" />
            <path d="m3 19 2 2 4-4" />
            <path d="M13 19h8" />
        </>,
        props,
        2
    )
}

export function InfoIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
        </>,
        props,
        2
    )
}

export function ForkIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="6" cy="4" r="1.5" />
            <circle cx="18" cy="4" r="1.5" />
            <circle cx="18" cy="20" r="1.5" />
            <path d="M6 5.5v4.75A5.75 5.75 0 0 0 11.75 16H16.5" />
            <path d="M12 16a5.75 5.75 0 0 0 5.75-5.75V5.5" />
        </>,
        props,
        2
    )
}

export function RewindIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 10 9 10" />
        </>,
        props,
        2
    )
}

/** Composer schedule-send clock — circle + hands (matches ComposerButtons). */
export function ScheduleIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
        </>,
        props,
        2
    )
}

/** Word-wrap toggle — lines with a wrap-around arrow on the last line. */
export function WrapIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M3 6h18" />
            <path d="M3 12h13a3 3 0 0 1 0 6h-4" />
            <polyline points="15 15 12 18 15 21" />
            <path d="M3 18h4" />
        </>,
        props,
        2
    )
}

/** Download — tray with an arrow dropping into it. */
export function DownloadIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5" />
            <polyline points="16.5 12 12 16.5 7.5 12" />
            <line x1="12" y1="16.5" x2="12" y2="3" />
        </>,
        props,
        2
    )
}
