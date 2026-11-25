import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'

import { Modal } from './Modal'

// ---------- toasts + notification history ----------
export interface Note { id: number; level: 'ok' | 'err' | 'info'; text: string; ts: number }
export interface Ui { notify(level: Note['level'], text: string): void; confirm(o: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean>; notes: Note[]; clearNotes(): void }
const Ctx = createContext<Ui>(null as never)
export const useUi = () => useContext(Ctx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]); const [toast, setToast] = useState<Note | null>(null)
  const [dlg, setDlg] = useState<{ o: Parameters<Ui['confirm']>[0]; res: (v: boolean) => void } | null>(null)
  const notify = useCallback((level: Note['level'], text: string) => { const n = { id: Date.now() + Math.random(), level, text, ts: Date.now() }; setNotes((l) => [n, ...l].slice(0, 100)); setToast(n); setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 5000) }, [])
  const confirm = useCallback((o: Parameters<Ui['confirm']>[0]) => new Promise<boolean>((res) => setDlg({ o, res })), [])
  useEffect(() => { const f = (ev: PromiseRejectionEvent) => { ev.preventDefault(); notify('err', String((ev.reason as Error)?.message ?? ev.reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }; window.addEventListener('unhandledrejection', f); return () => window.removeEventListener('unhandledrejection', f) }, [notify]) // safety net: a failed fire-and-forget call becomes a message, never a silent error
  const close = (v: boolean) => { dlg?.res(v); setDlg(null) }
  return (
    <Ctx.Provider value={{ notify, confirm, notes, clearNotes: () => setNotes([]) }}>
      {children}
      {toast && <div className={`toast ${toast.level}`} role="status" aria-live="polite">{toast.level === 'ok' ? <CircleCheck size={16} aria-hidden="true" /> : toast.level === 'err' ? <CircleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<span>{toast.text}</span></div>}
      {dlg && (
        <Modal title={dlg.o.title} onClose={() => close(false)} footer={<><button onClick={() => close(false)}>Cancel</button><button autoFocus className={dlg.o.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{dlg.o.confirmLabel ?? 'Confirm'}</button></>}>{dlg.o.body}</Modal>
      )}
    </Ctx.Provider>
  )
}
