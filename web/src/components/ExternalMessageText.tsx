export function ExternalMessageText(props: { text: string }) {
    return (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {props.text}
        </div>
    )
}
