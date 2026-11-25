import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, children, footer, onClose, wide, bare }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); if (!ref.current?.contains(document.activeElement)) ref.current?.focus(); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={['modal', wide && 'wide', bare && 'bare'].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="mhead"><h3>{title}</h3><button className="icon" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  )
}
