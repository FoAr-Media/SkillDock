import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * Draggable divider for a panel width. The width lives in a CSS variable on <html> (so every pane using it follows) and is persisted in localStorage.
 * Place it inside the positioned container whose left edge is the origin (the app grid for the sidebar, a `.split` for list/detail panes).
 * Pointer drag, ←/→ keys (16px, Shift = 64px) and double-click to reset. Values are px and clamped by `min`/`max`.
 */
export function ResizeHandle({ cssVar, storageKey, label, min, max, className }: { cssVar: string; storageKey: string; label: string; min: number; max: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null), [drag, setDrag] = useState(false), [now, setNow] = useState<number>()
  const apply = (px: number | null) => {
    const r = document.documentElement
    if (px === null) { r.style.removeProperty(cssVar); try { localStorage.removeItem(storageKey) } catch { /* ignore */ } setNow(undefined); return }
    const v = Math.round(Math.min(Math.max(px, min), max)); r.style.setProperty(cssVar, `${v}px`); setNow(v); return v
  }
  useLayoutEffect(() => { setNow(Math.round(ref.current!.offsetLeft + 4)); try { const v = Number(localStorage.getItem(storageKey)); if (v >= min && v <= max) apply(v) } catch { /* ignore */ } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const origin = () => ref.current!.parentElement!.getBoundingClientRect().left
  const save = (v?: number) => { if (v !== undefined) try { localStorage.setItem(storageKey, String(v)) } catch { /* ignore */ } }
  const move = (e: PointerEvent) => { if (drag) apply(e.clientX - origin()) }
  const key = (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0); if (!step) return
    e.preventDefault(); save(apply(ref.current!.offsetLeft + 4 + step /* +4: the handle is centred on the edge (margin-left -4px) */))
  }
  return <div ref={ref} className={['resize', className, drag && 'dragging'].filter(Boolean).join(' ')} role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={now} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); document.body.classList.add('resizing') }}
    onPointerMove={move} onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDrag(false); document.body.classList.remove('resizing'); save(apply(e.clientX - origin())) }}
    onDoubleClick={() => { apply(null); requestAnimationFrame(() => setNow(Math.round(ref.current!.offsetLeft + 4))) }} onKeyDown={key} />
}
