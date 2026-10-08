import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import type { ExternalConversation, ExternalMessage } from '@hapi/protocol/messengers'
import type { ApiClient } from '../src/api/client'
import { ChatConversationPane } from '../src/routes/chats'
import { AppContextProvider } from '../src/lib/app-context'
import { I18nProvider } from '../src/lib/i18n-context'
import '../src/index.css'

const conversations: ExternalConversation[] = ['short', 'long', 'bubbles-telegram', 'bubbles-telemost'].map(id => ({
    id, provider: id === 'bubbles-telemost' ? 'yandex' : 'telegram', remoteId: id, title: id, kind: 'direct',
    selected: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
}))
const thumbnail = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#4682b4"/></svg>')}`
const bubbleTexts = [
    'Коллеге',
    'Может терпения на\n"Стальных нервов"\nзаменить',
    'Пусть все твои маленькие и большие мечты реализуются! Терпения тебе и крепкого здоровья!',
    'Оченьдлинноесловобезпробеловкотороеобязательнодолжнопереноситьсяинамобильномэкране',
    'Смотри https://example.com/очень/длинная/ссылка/без/пробелов',
]
const bubbleMessages = (id: string): ExternalMessage[] => bubbleTexts.flatMap((text, index) => (
    (['incoming', 'outgoing'] as const).map(direction => ({
        id: `${id}-${index}-${direction}`, conversationId: id,
        providerMessageId: `bubble-${index}-${direction}`,
        senderId: direction === 'incoming' ? 'peer' : 'self', senderName: 'Peer', direction,
        text, createdAt: Date.now() - index * 60_000, editedAt: null, media: [],
        ...(direction === 'outgoing' ? { deliveryStatus: 'read' as const } : {}),
    }))
))
const api = {
    getMessengerConnections: async () => ({ connections: [] }),
    getExternalConversations: async () => ({ conversations }),
    getExternalMessages: async (id: string) => ({
        messages: id.startsWith('bubbles-') ? bubbleMessages(id) : Array.from({ length: id === 'short' ? 30 : 70 }, (_, index): ExternalMessage => ({
            id: `${id}-${index}`, conversationId: id, providerMessageId: `${id}-${index}`,
            senderId: 'peer', senderName: 'Peer', direction: 'incoming',
            text: `${id} message ${index}`, createdAt: index * 60_000,
            editedAt: null, media: index % 8 === 5 ? [{
                kind: 'image', mimeType: 'image/svg+xml', fileName: 'photo.svg', size: null,
                thumbnailDataUrl: thumbnail,
            }] : [],
        })),
        participants: [],
    }),
    getExternalMediaBlob: async () => {
        await new Promise(resolve => setTimeout(resolve, 120))
        return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#4682b4"/></svg>'], { type: 'image/svg+xml' })
    },
    setConversationActive: async () => {},
} as unknown as ApiClient

function Fixture() {
    const [id, setId] = useState('short')
    return <div className="flex h-dvh flex-col">
        <nav className="flex shrink-0 gap-4">
            {conversations.map(conversation => <button key={conversation.id}
                onClick={() => setId(conversation.id)}>Open {conversation.id}</button>)}
        </nav>
        <div className="min-h-0 flex-1">
            <ChatConversationPane conversationId={id} backTo="/chats" />
        </div>
    </div>
}

const router = createRouter({ routeTree: createRootRoute({ component: Fixture }) })
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={new QueryClient()}>
        <AppContextProvider value={{ api, token: '', baseUrl: '' }}>
            <I18nProvider><RouterProvider router={router} /></I18nProvider>
        </AppContextProvider>
    </QueryClientProvider>,
)
