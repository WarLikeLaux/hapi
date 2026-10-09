const DEFAULT_FAVICON = '/icon.png'

/** Update the document favicon link element(s) with the specified image href. */
export function setFavicon(href: string): void {
    if (typeof document === 'undefined') {
        return
    }

    const links = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']")
    if (links.length > 0) {
        links.forEach((link) => {
            link.type = 'image/png'
            link.removeAttribute('sizes')
            link.href = href
        })
    } else {
        const link = document.createElement('link')
        link.rel = 'icon'
        link.type = 'image/png'
        link.href = href
        document.head.appendChild(link)
    }
}

export function resetFavicon(): void {
    setFavicon(DEFAULT_FAVICON)
}
