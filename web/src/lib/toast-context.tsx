import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomId } from '@/lib/randomId'

export type Toast = {
    id: string
    title: string
    body: string
    sessionId: string
    url: string
    dedupeKey?: string
}

export type ToastContextValue = {
    toasts: Toast[]
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
    dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const TOAST_DURATION_MS = 6000
const TOAST_DISMISS_SUPPRESSION_MS = 5 * 60 * 1000

function createToastId(): string {
    return randomId()
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const dismissedUntilRef = useRef<Map<string, number>>(new Map())

    useEffect(() => {
        return () => {
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer)
            }
            timersRef.current.clear()
        }
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const dismissToast = useCallback((id: string) => {
        setToasts((prev) => {
            const toast = prev.find((candidate) => candidate.id === id)
            if (toast?.dedupeKey) {
                dismissedUntilRef.current.set(
                    toast.dedupeKey,
                    Date.now() + TOAST_DISMISS_SUPPRESSION_MS,
                )
            }
            return prev.filter((candidate) => candidate.id !== id)
        })
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        if (toast.dedupeKey) {
            const dismissedUntil = dismissedUntilRef.current.get(toast.dedupeKey) ?? 0
            if (dismissedUntil > Date.now()) return
            dismissedUntilRef.current.delete(toast.dedupeKey)
        }

        const id = createToastId()
        setToasts((prev) => [...prev, { id, ...toast }])
        const timer = setTimeout(() => {
            removeToast(id)
        }, TOAST_DURATION_MS)
        timersRef.current.set(id, timer)
    }, [removeToast])

    const value = useMemo<ToastContextValue>(() => ({
        toasts,
        addToast,
        removeToast,
        dismissToast,
    }), [toasts, addToast, removeToast, dismissToast])

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return ctx
}
