'use client'

import { useSyncExternalStore } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

type Toast = { id: number; message: string; tone: 'success' | 'error' }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function notify(message: string, tone: Toast['tone'] = 'success') {
  const id = nextId++
  toasts = [...toasts, { id, message, tone }]
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id)
    emit()
  }, 2600)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const empty: Toast[] = []

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => empty)
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.tone === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
          {toast.message}
        </div>
      ))}
    </div>
  )
}
