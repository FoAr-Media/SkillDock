import { useEffect, useRef, type RefObject } from 'react'

/**
 * Auto-dismiss behaviour for popovers (notifications, menus): closes on outside pointer, Escape, and after `idleMs` of no interaction
 * (the timer pauses while the pointer or keyboard focus is inside). Route changes are handled by the caller closing on navigation.
 */
export function useAutoDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement | null>[], idleMs = 9000) {
  const closeRef = useRef(close); closeRef.current = close
  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => refs.some((r) => r.current?.contains(t as Node))
    let timer: ReturnType<typeof setTimeout>, paused = false
    const arm = () => { clearTimeout(timer); if (idleMs > 0 && !paused) timer = setTimeout(() => closeRef.current(), idleMs) }
    const down = (e: PointerEvent) => { if (!inside(e.target)) closeRef.current(); else arm() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeRef.current() } else arm() }
    const enter = () => { paused = true; clearTimeout(timer) }, leave = () => { paused = false; arm() }
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true)
    const els = refs.map((r) => r.current).filter(Boolean) as HTMLElement[]
    els.forEach((el) => { el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave); el.addEventListener('focusin', enter); el.addEventListener('focusout', leave) })
    arm()
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); els.forEach((el) => { el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); el.removeEventListener('focusin', enter); el.removeEventListener('focusout', leave) }) }
  }, [open, idleMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
