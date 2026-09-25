import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { AppContextProvider, type AppContextValue } from '@/lib/app-context'

// Components under test receive api={null}; the hub-sync hooks guard on
// Boolean(api), so this stub keeps queries disabled and ownership false.
export const testAppContextValue: AppContextValue = {
    api: null as unknown as ApiClient,
    token: '',
    baseUrl: '',
}

export function AppContextTestProvider(props: { children: ReactNode }) {
    return (
        <AppContextProvider value={testAppContextValue}>
            {props.children}
        </AppContextProvider>
    )
}
